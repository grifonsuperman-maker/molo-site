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

function kyivToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv',
  }).format(new Date());
}

function createService() {
  const guestToken = 'guest-token-for-booking-1';
  const booking = {
    id: 'booking-1',
    status: 'approved',
    bookingDate: kyivToday(),
    checkedInAt: new Date(),
    table: {
      id: 'table-1',
      tableNumber: '8',
      status: 'occupied',
    },
    client: { fullName: 'Гість' },
  };
  const calls = [];
  let bookingLoads = 0;
  let tableLocks = 0;

  const bookings = {
    exist: async ({ where }) =>
      where.id === booking.id &&
      where.guestAccessTokenHash === hashToken(guestToken),
    findOne: async ({ where }) => {
      bookingLoads += 1;
      return where.id === booking.id ? booking : null;
    },
    createQueryBuilder: () => ({
      where() {
        return this;
      },
      setLock() {
        return this;
      },
      async getOne() {
        return { id: booking.id };
      },
    }),
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
  const callRecords = {
    async findOne({ where }) {
      if (where?.id) return calls.find((call) => call.id === where.id) || null;
      if (where?.booking?.id) {
        return calls.find(
          (call) =>
            call.booking.id === where.booking.id &&
            (call.status === 'new' || call.status === 'accepted'),
        ) || null;
      }
      return null;
    },
    create(value) {
      return {
        ...value,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    },
    async save(value) {
      calls.push(value);
      return value;
    },
  };
  const staff = {
    async findOne({ where }) {
      return where.id === 'waiter-b' ? { id: 'waiter-b', fullName: 'Сергій' } : null;
    },
  };
  const tables = {
    async findOne({ where, lock }) {
      assert.equal(lock?.mode, 'pessimistic_write');
      tableLocks += 1;
      return where.id === booking.table.id ? booking.table : null;
    },
  };
  const getRepository = (entity) => {
    if (entity.name === 'WaiterCallRecord') return callRecords;
    if (entity.name === 'TableEntity') return tables;
    if (entity.name === 'Staff') return staff;
    return bookings;
  };
  const dataSource = {
    getRepository,
    transaction: async (work) => work({ getRepository }),
  };

  return {
    booking,
    calls,
    guestToken,
    get bookingLoads() {
      return bookingLoads;
    },
    get tableLocks() {
      return tableLocks;
    },
    service: new WaiterCallsService(
      bookings,
      histories,
      callRecords,
      dataSource,
    ),
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

test('approved booking at an occupied table cannot call before its own guest checks in', async () => {
  const state = createService();
  state.booking.checkedInAt = null;

  const status = await state.service.guestStatus(state.booking.id, state.guestToken);
  assert.equal(status.bookingStatus, 'approved');
  assert.equal(status.tableStatus, 'occupied');
  assert.equal(status.canCall, false);

  await assert.rejects(
    () => state.service.createFromGuest({ bookingId: state.booking.id }, state.guestToken),
    (error) => {
      assert.equal(error.status, 400);
      assert.match(error.message, /тільки після приходу гостя/);
      return true;
    },
  );
  assert.equal(state.calls.length, 0);

  state.booking.checkedInAt = new Date();
  const afterArrival = await state.service.guestStatus(state.booking.id, state.guestToken);
  assert.equal(afterArrival.canCall, true);
  const created = await state.service.createFromGuest({ bookingId: state.booking.id }, state.guestToken);
  assert.equal(created.call.bookingId, state.booking.id);
  assert.equal(state.calls.length, 1);
});

test('past and future checked-in bookings cannot call today's occupied table', async () => {
  for (const bookingDate of ['2000-01-01', '2099-01-01']) {
    const state = createService();
    state.booking.bookingDate = bookingDate;
    const status = await state.service.guestStatus(state.booking.id, state.guestToken);
    assert.equal(status.canCall, false);
    await assert.rejects(
      () => state.service.createFromGuest({ bookingId: state.booking.id }, state.guestToken),
      (error) => error.status === 400,
    );
    assert.equal(state.calls.length, 0);
    assert.equal(state.tableLocks, 0);
  }
});

test('guest waiter call follows the current table owner rather than stale assignment', async () => {
  const state = createService();
  state.booking.table.assignedWaiterId = 'waiter-b';
  await state.service.assign({
    bookingId: state.booking.id,
    waiterId: 'waiter-a',
    waiterName: 'Андрій',
  });

  const status = await state.service.guestStatus(state.booking.id, state.guestToken);
  assert.equal(status.waiterAssigned, true);
  assert.equal(status.waiterName, 'Сергій');
  const created = await state.service.createFromGuest(
    { bookingId: state.booking.id }, state.guestToken,
  );
  assert.equal(created.call.waiterId, 'waiter-b');
  assert.equal(created.call.waiterName, 'Сергій');
  assert.equal(state.tableLocks, 1);
});

test('a released table does not send the next guest call to its previous waiter', async () => {
  const state = createService();
  state.booking.table.assignedWaiterId = null;
  await state.service.assign({
    bookingId: state.booking.id,
    waiterId: 'waiter-a',
    waiterName: 'Андрій',
  });

  const status = await state.service.guestStatus(state.booking.id, state.guestToken);
  assert.equal(status.waiterAssigned, false);
  const created = await state.service.createFromGuest(
    { bookingId: state.booking.id }, state.guestToken,
  );
  assert.equal(created.call.waiterId, null);
  assert.match(created.message, /загальний список/);
  assert.equal(state.tableLocks, 1);
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
