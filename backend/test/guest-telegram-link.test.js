require('reflect-metadata');

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const test = require('node:test');

const {
  GuestTelegramLinkService,
} = require('../dist/bookings/guest-telegram-link.service.js');

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function createState(options = {}) {
  const bookingId = 'b5a6276d-cd57-4c8d-9368-f28dc881be67';
  const guestToken = 'owned-booking-token';
  const telegramId = '123456789';
  const client = {
    id: 'client-1',
    telegramId: options.clientTelegramId ?? null,
  };
  const booking = { id: bookingId, client: { id: client.id } };
  const bookingParams = {};
  let transactionCalls = 0;
  let clientSaveCalls = 0;
  let bookingSaveCalls = 0;
  let uniqueViolationThrown = false;

  const bookingQuery = {
    leftJoinAndSelect() { return this; },
    where(_sql, params) { Object.assign(bookingParams, params); return this; },
    andWhere(_sql, params) { Object.assign(bookingParams, params); return this; },
    setLock() { return this; },
    async getOne() {
      if (options.bookingMissing) return null;
      return (
        bookingParams.bookingId === bookingId &&
        bookingParams.guestAccessTokenHash === hashToken(guestToken)
      ) ? booking : null;
    },
  };

  const clientQuery = {
    where() { return this; },
    setLock() { return this; },
    async getOne() { return options.clientMissing ? null : client; },
  };

  const bookingRepo = {
    createQueryBuilder: () => bookingQuery,
    save: async (value) => {
      bookingSaveCalls += 1;
      return value;
    },
  };
  const clientRepo = {
    createQueryBuilder: () => clientQuery,
    findOne: async ({ where }) => {
      if (where.telegramId !== telegramId) return null;
      if (options.linkedClient) return options.linkedClient;
      if (
        options.linkedClientAfterRetry &&
        transactionCalls >= 2
      ) {
        return options.linkedClientAfterRetry;
      }
      return null;
    },
    save: async (value) => {
      clientSaveCalls += 1;
      if (options.uniqueViolationOnce && !uniqueViolationThrown) {
        uniqueViolationThrown = true;
        value.telegramId = options.clientTelegramId ?? null;
        const error = new Error('unique violation');
        error.code = '23505';
        throw error;
      }
      return value;
    },
  };
  const manager = {
    getRepository(entity) {
      if (entity?.name === 'Booking') return bookingRepo;
      if (entity?.name === 'Client') return clientRepo;
      throw new Error(`Unexpected repository: ${entity?.name}`);
    },
  };
  const dataSource = {
    transaction: async (callback) => {
      transactionCalls += 1;
      return callback(manager);
    },
  };

  return {
    bookingId,
    guestToken,
    telegramId,
    client,
    booking,
    bookingParams,
    service: new GuestTelegramLinkService(dataSource),
    transactionCalls: () => transactionCalls,
    clientSaveCalls: () => clientSaveCalls,
    bookingSaveCalls: () => bookingSaveCalls,
  };
}

function guestUser(telegramId = '123456789') {
  return {
    sub: telegramId,
    telegramId,
    staffId: null,
    role: 'guest',
    name: 'Guest',
  };
}

test('Telegram link requires the booking guest token before opening a transaction', async () => {
  const state = createState();

  await assert.rejects(
    () => state.service.link(state.bookingId, '', guestUser()),
    (error) => error.status === 401 && error.message === 'Недійсний доступ до бронювання',
  );

  assert.equal(state.transactionCalls(), 0);
});

test('Telegram link requires an authenticated Telegram guest', async () => {
  const state = createState();

  await assert.rejects(
    () => state.service.link(state.bookingId, state.guestToken, {
      ...guestUser(),
      role: 'waiter',
    }),
    (error) => error.status === 401,
  );

  assert.equal(state.transactionCalls(), 0);
});

test('Telegram link rejects a token from another booking', async () => {
  const state = createState();

  await assert.rejects(
    () => state.service.link(state.bookingId, 'another-token', guestUser()),
    (error) => error.status === 401 && error.message === 'Недійсний доступ до бронювання',
  );

  assert.equal(state.clientSaveCalls(), 0);
  assert.equal(state.bookingSaveCalls(), 0);
});

test('Telegram link stores the verified Telegram id for the owned booking client', async () => {
  const state = createState();

  const result = await state.service.link(
    state.bookingId,
    state.guestToken,
    guestUser(state.telegramId),
  );

  assert.equal(result.linked, true);
  assert.equal(state.client.telegramId, state.telegramId);
  assert.equal(state.clientSaveCalls(), 1);
  assert.equal(state.bookingSaveCalls(), 0);
  assert.equal(
    state.bookingParams.guestAccessTokenHash,
    hashToken(state.guestToken),
  );
});

test('Telegram link does not rewrite a client linked to another Telegram', async () => {
  const state = createState({ clientTelegramId: '987654321' });

  await assert.rejects(
    () => state.service.link(state.bookingId, state.guestToken, guestUser()),
    (error) => error.status === 409 && error.message === 'Цей гість уже прив’язаний до іншого Telegram',
  );

  assert.equal(state.client.telegramId, '987654321');
  assert.equal(state.clientSaveCalls(), 0);
  assert.equal(state.bookingSaveCalls(), 0);
});

test('Telegram link attaches an owned booking to the client already linked to this Telegram', async () => {
  const linkedClient = { id: 'client-2', telegramId: '123456789' };
  const state = createState({ linkedClient });

  const result = await state.service.link(
    state.bookingId,
    state.guestToken,
    guestUser(),
  );

  assert.equal(result.linked, true);
  assert.equal(state.booking.client, linkedClient);
  assert.equal(state.client.telegramId, null);
  assert.equal(state.clientSaveCalls(), 0);
  assert.equal(state.bookingSaveCalls(), 1);
});

test('Telegram link recovers a concurrent unique-id race by attaching the owned booking to the winner', async () => {
  const linkedClientAfterRetry = { id: 'client-2', telegramId: '123456789' };
  const state = createState({
    uniqueViolationOnce: true,
    linkedClientAfterRetry,
  });

  const result = await state.service.link(
    state.bookingId,
    state.guestToken,
    guestUser(),
  );

  assert.equal(result.linked, true);
  assert.equal(state.transactionCalls(), 2);
  assert.equal(state.clientSaveCalls(), 1);
  assert.equal(state.bookingSaveCalls(), 1);
  assert.equal(state.booking.client, linkedClientAfterRetry);
});
