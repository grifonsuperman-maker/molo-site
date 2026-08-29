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

test('Telegram reassignment refreshes completed-visit stats for both clients', async () => {
  const bookingId = 'b5a6276d-cd57-4c8d-9368-f28dc881be67';
  const guestToken = 'owned-booking-token';
  const telegramId = '123456789';
  const completedAt = new Date('2099-02-03T20:00:00.000Z');

  const oldClient = {
    id: 'client-1',
    telegramId: null,
    visitsCount: 1,
    totalGuests: 4,
    lastVisitAt: completedAt,
  };
  const linkedClient = {
    id: 'client-2',
    telegramId,
    visitsCount: 0,
    totalGuests: 0,
    lastVisitAt: null,
  };
  const booking = {
    id: bookingId,
    client: oldClient,
    status: 'completed',
    guestsCount: 4,
    completedAt,
  };

  const bookingParams = {};
  const statsClientIds = [];
  let bookingSaveCalls = 0;
  let clientSaveCalls = 0;

  const bookingRepository = {
    createQueryBuilder() {
      let mode = 'owned';
      return {
        leftJoinAndSelect() { return this; },
        leftJoin() {
          mode = 'stats';
          return this;
        },
        where(_sql, params) {
          Object.assign(bookingParams, params);
          if (params?.clientId) statsClientIds.push(params.clientId);
          return this;
        },
        andWhere(_sql, params) {
          Object.assign(bookingParams, params);
          return this;
        },
        setLock() { return this; },
        async getOne() {
          if (mode !== 'owned') return null;
          return (
            bookingParams.bookingId === bookingId &&
            bookingParams.guestAccessTokenHash === hashToken(guestToken)
          ) ? booking : null;
        },
        async getMany() {
          if (mode !== 'stats') return [];
          return booking.client?.id === bookingParams.clientId ? [booking] : [];
        },
      };
    },
    async save(value) {
      bookingSaveCalls += 1;
      return value;
    },
  };

  const clientRepository = {
    createQueryBuilder() {
      return {
        where() { return this; },
        setLock() { return this; },
        async getOne() { return oldClient; },
      };
    },
    async findOne({ where }) {
      if (where.telegramId === telegramId) return linkedClient;
      if (where.id === oldClient.id) return oldClient;
      if (where.id === linkedClient.id) return linkedClient;
      return null;
    },
    async save(value) {
      clientSaveCalls += 1;
      return value;
    },
  };

  const manager = {
    getRepository(entity) {
      if (entity?.name === 'Booking') return bookingRepository;
      if (entity?.name === 'Client') return clientRepository;
      throw new Error(`Unexpected repository: ${entity?.name}`);
    },
  };
  const dataSource = {
    transaction: async (callback) => callback(manager),
  };

  const service = new GuestTelegramLinkService(dataSource);
  const result = await service.link(bookingId, guestToken, {
    sub: telegramId,
    telegramId,
    staffId: null,
    role: 'guest',
    name: 'Guest',
  });

  assert.equal(result.linked, true);
  assert.equal(booking.client, linkedClient);
  assert.deepEqual(statsClientIds, [oldClient.id, linkedClient.id]);
  assert.equal(oldClient.visitsCount, 0);
  assert.equal(oldClient.totalGuests, 0);
  assert.equal(oldClient.lastVisitAt, null);
  assert.equal(linkedClient.visitsCount, 1);
  assert.equal(linkedClient.totalGuests, 4);
  assert.equal(linkedClient.lastVisitAt, completedAt);
  assert.equal(bookingSaveCalls, 1);
  assert.equal(clientSaveCalls, 2);
});
