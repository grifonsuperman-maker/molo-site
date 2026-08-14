require('reflect-metadata');

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const test = require('node:test');

const {
  WaiterCallsService,
} = require('../dist/waiter-calls/waiter-calls.service.js');

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function createService() {
  const guestToken = 'guest-token-for-booking-1';
  const booking = {
    id: 'booking-1',
    status: 'approved',
    table: {
      id: 'table-1',
      tableNumber: '8',
      status: 'occupied',
    },
    client: { fullName: 'Гість' },
  };
  let bookingLoads = 0;

  const bookings = {
    exist: async ({ where }) =>
      where.id === booking.id &&
      where.guestAccessTokenHash === hashToken(guestToken),
    findOne: async ({ where }) => {
      bookingLoads += 1;
      return where.id === booking.id ? booking : null;
    },
  };
  const histories = {
    createQueryBuilder: () => ({
      leftJoin() {
        return this;
      },
      where() {
        return this;
      },
      andWhere() {
        return this;
      },
      orderBy() {
        return this;
      },
      async getOne() {
        return null;
      },
    }),
  };

  return {
    booking,
    guestToken,
    get bookingLoads() {
      return bookingLoads;
    },
    service: new WaiterCallsService(bookings, histories),
  };
}

async function expectGuestAccessRejected(action) {
  await assert.rejects(action, (error) => {
    assert.equal(error.message, 'Недійсний доступ до бронювання');
    assert.equal(error.status, 401);
    return true;
  });
}

test('guest waiter status requires the token of the same booking', async () => {
  const state = createService();

  await expectGuestAccessRejected(() =>
    state.service.guestStatus(state.booking.id),
  );
  await expectGuestAccessRejected(() =>
    state.service.guestStatus(state.booking.id, 'token-from-another-booking'),
  );

  assert.equal(state.bookingLoads, 0);

  const status = await state.service.guestStatus(
    state.booking.id,
    state.guestToken,
  );

  assert.equal(status.bookingId, state.booking.id);
  assert.equal(status.canCall, true);
  assert.equal(state.bookingLoads, 1);
});

test('guest waiter call rejects another booking token', async () => {
  const state = createService();

  await expectGuestAccessRejected(() =>
    state.service.createFromGuest(
      { bookingId: state.booking.id },
      'token-from-another-booking',
    ),
  );

  assert.equal(state.bookingLoads, 0);
});

test('guest waiter call keeps working with its own booking token', async () => {
  const state = createService();

  const result = await state.service.createFromGuest(
    { bookingId: state.booking.id },
    state.guestToken,
  );

  assert.equal(result.call.bookingId, state.booking.id);
  assert.equal(result.call.tableNumber, '8');
  assert.equal(result.call.status, 'new');
  assert.equal(state.bookingLoads, 1);
});
