const assert = require('node:assert/strict');
const test = require('node:test');

const {
  AdminAttentionService,
} = require('../dist/bookings/admin-attention.service.js');
const {
  BookingTableLockService,
} = require('../dist/bookings/booking-table-lock.service.js');
const { Booking } = require('../dist/bookings/entities/booking.entity.js');
const {
  BookingTableChangeRequest,
} = require('../dist/bookings/entities/booking-table-change-request.entity.js');
const { TableEntity } = require('../dist/tables/entities/table.entity.js');

function kyivDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function buildStatusManager(table, activeBookings) {
  const saves = [];
  const tableRepository = {
    findOne: async () => table,
    save: async (value) => {
      saves.push(value.status);
      return value;
    },
  };
  const bookingRepository = {
    find: async () => activeBookings,
  };

  return {
    saves,
    manager: {
      getRepository(entity) {
        if (entity === TableEntity) return tableRepository;
        if (entity === Booking) return bookingRepository;
        throw new Error(`Unexpected repository: ${entity?.name || entity}`);
      },
    },
  };
}

function createRecordingQueryBuilder(result, calls) {
  return {
    innerJoinAndSelect(...args) {
      calls.push(['innerJoinAndSelect', ...args]);
      return this;
    },
    leftJoinAndSelect(...args) {
      calls.push(['leftJoinAndSelect', ...args]);
      return this;
    },
    where(...args) {
      calls.push(['where', ...args]);
      return this;
    },
    andWhere(...args) {
      calls.push(['andWhere', ...args]);
      return this;
    },
    setLock(...args) {
      calls.push(['setLock', ...args]);
      return this;
    },
    async getOne() {
      calls.push(['getOne']);
      return result;
    },
  };
}

test('admin table-change approval enters the shared transfer lock', async () => {
  const requests = {
    findOne: async () => ({ booking: { id: 'booking-1' } }),
  };
  const service = new BookingTableLockService({}, {}, {}, requests);
  const calls = [];

  service.withTransferLock = async (bookingId, tableId, work) => {
    calls.push({ bookingId, tableId });
    return work();
  };

  const result = await service.withTableChangeRequestLock(
    'request-1',
    'table-9',
    async () => 'approved',
  );

  assert.equal(result, 'approved');
  assert.deepEqual(calls, [{ bookingId: 'booking-1', tableId: 'table-9' }]);
});

test('missing table-change request still reaches the guarded approval path', async () => {
  const requests = { findOne: async () => null };
  const service = new BookingTableLockService({}, {}, {}, requests);
  let workCalls = 0;

  service.withTransferLock = async () => {
    throw new Error('transfer lock must not run without a booking id');
  };

  const result = await service.withTableChangeRequestLock(
    'missing-request',
    'table-9',
    async () => {
      workCalls += 1;
      return 'not-found-is-validated-by-service';
    },
  );

  assert.equal(result, 'not-found-is-validated-by-service');
  assert.equal(workCalls, 1);
});

test('approval row locks target only safe lowercase base aliases while nullable relations are loaded', async () => {
  const service = new AdminAttentionService({}, {}, {});
  const requestCalls = [];
  const bookingCalls = [];
  const tableCalls = [];
  const manager = {
    getRepository(entity) {
      if (entity === BookingTableChangeRequest) {
        return {
          createQueryBuilder(alias) {
            requestCalls.push(['alias', alias]);
            return createRecordingQueryBuilder({ id: 'request-1' }, requestCalls);
          },
        };
      }
      if (entity === Booking) {
        return {
          createQueryBuilder(alias) {
            bookingCalls.push(['alias', alias]);
            return createRecordingQueryBuilder({ id: 'booking-1' }, bookingCalls);
          },
        };
      }
      if (entity === TableEntity) {
        return {
          createQueryBuilder(alias) {
            tableCalls.push(['alias', alias]);
            return createRecordingQueryBuilder({ id: 'table-1' }, tableCalls);
          },
        };
      }
      throw new Error(`Unexpected repository: ${entity?.name || entity}`);
    },
  };

  await service.findTableChangeForUpdate(manager, 'request-1');
  await service.findBookingForUpdate(manager, 'booking-1');
  await service.findTableForUpdate(manager, 'table-1');

  assert.deepEqual(
    requestCalls.find((call) => call[0] === 'setLock'),
    ['setLock', 'pessimistic_write', undefined, ['request']],
  );
  assert.deepEqual(
    bookingCalls.find((call) => call[0] === 'setLock'),
    ['setLock', 'pessimistic_write', undefined, ['booking']],
  );
  assert.deepEqual(
    tableCalls.find((call) => call[0] === 'alias'),
    ['alias', 'locked_table'],
  );
  assert.deepEqual(
    tableCalls.find((call) => call[0] === 'setLock'),
    ['setLock', 'pessimistic_write', undefined, ['locked_table']],
  );
  assert.ok(requestCalls.some((call) => call[0] === 'leftJoinAndSelect'));
  assert.ok(bookingCalls.some((call) => call[0] === 'leftJoinAndSelect'));
  assert.ok(tableCalls.some((call) => call[0] === 'leftJoinAndSelect'));
});

test('old table stays reserved when another approved booking remains today', async () => {
  const service = new AdminAttentionService({}, {}, {});
  const table = { id: 'old-table', status: 'free' };
  const { manager, saves } = buildStatusManager(table, [{ status: 'approved' }]);

  await service.synchronizeTableForDate(manager, table.id, kyivDate());

  assert.equal(table.status, 'reserved');
  assert.deepEqual(saves, ['reserved']);
});

test('old table becomes pending when only a pending booking remains today', async () => {
  const service = new AdminAttentionService({}, {}, {});
  const table = { id: 'old-table', status: 'reserved' };
  const { manager, saves } = buildStatusManager(table, [{ status: 'pending' }]);

  await service.synchronizeTableForDate(manager, table.id, kyivDate());

  assert.equal(table.status, 'pending');
  assert.deepEqual(saves, ['pending']);
});

test('old table becomes free only when no active booking remains today', async () => {
  const service = new AdminAttentionService({}, {}, {});
  const table = { id: 'old-table', status: 'reserved' };
  const { manager, saves } = buildStatusManager(table, []);

  await service.synchronizeTableForDate(manager, table.id, kyivDate());

  assert.equal(table.status, 'free');
  assert.deepEqual(saves, ['free']);
});


test('admin approval treats a banquet secondary table as an occupied destination', async () => {
  const service = new AdminAttentionService({}, {}, {}, {});
  const calls = [];
  const conflictBooking = {
    id: 'banquet-1',
    bookingDate: '2099-05-01',
    bookingTime: '18:30:00',
    durationMinutes: 120,
    status: 'approved',
  };
  const query = {
    leftJoin(...args) {
      calls.push(['leftJoin', ...args]);
      return this;
    },
    where(...args) {
      calls.push(['where', ...args]);
      return this;
    },
    distinct(...args) {
      calls.push(['distinct', ...args]);
      return this;
    },
    andWhere(...args) {
      calls.push(['andWhere', ...args]);
      return this;
    },
    orderBy(...args) {
      calls.push(['orderBy', ...args]);
      return this;
    },
    async getMany() {
      return [conflictBooking];
    },
  };
  const manager = {
    async query(sql) {
      calls.push(['query', sql]);
      return [{ ready: true }];
    },
    getRepository(entity) {
      assert.equal(entity, Booking);
      return {
        createQueryBuilder(alias) {
          assert.equal(alias, 'candidate');
          return query;
        },
      };
    },
  };

  await assert.rejects(
    () => service.assertNoConflict(
      manager,
      { id: 'table-secondary' },
      {
        id: 'booking-moving',
        bookingDate: '2099-05-01',
        bookingTime: '19:00:00',
        durationMinutes: 120,
      },
    ),
    /Цей стіл має інше бронювання у вибраний час/,
  );

  assert.ok(calls.some((call) =>
    call[0] === 'leftJoin' &&
    call[1] === 'candidate.tableAssignments' &&
    call[2] === 'tableAssignment'
  ));
  assert.ok(calls.some((call) =>
    call[0] === 'where' &&
    String(call[1]).includes('assignedTable.id = :tableId')
  ));
});

test('admin table-change conflict check keeps legacy primary-table query before banquet schema adoption', async () => {
  const service = new AdminAttentionService({}, {}, {}, {});
  const calls = [];
  const query = {
    leftJoin(...args) {
      calls.push(['leftJoin', ...args]);
      return this;
    },
    where(...args) {
      calls.push(['where', ...args]);
      return this;
    },
    andWhere() { return this; },
    orderBy() { return this; },
    async getMany() { return []; },
  };
  const manager = {
    async query() { return [{ ready: false }]; },
    getRepository() {
      return { createQueryBuilder: () => query };
    },
  };

  await service.assertNoConflict(
    manager,
    { id: 'table-legacy' },
    {
      id: 'booking-moving',
      bookingDate: '2099-05-01',
      bookingTime: '19:00:00',
      durationMinutes: 120,
    },
  );

  assert.ok(calls.some((call) =>
    call[0] === 'where' &&
    call[1] === 'table.id = :tableId'
  ));
  assert.equal(
    calls.some((call) => call[0] === 'leftJoin' && call[1] === 'candidate.tableAssignments'),
    false,
  );
});


test('old table stays reserved when only a later banquet secondary assignment remains today', async () => {
  const service = new AdminAttentionService({}, {}, {}, {});
  const table = { id: 'old-table-secondary', status: 'free' };
  const saves = [];
  const calls = [];
  const tableRepository = {
    async findOne() { return table; },
    async save(value) {
      saves.push(value.status);
      return value;
    },
  };
  const query = {
    leftJoin(...args) {
      calls.push(['leftJoin', ...args]);
      return this;
    },
    where(...args) {
      calls.push(['where', ...args]);
      return this;
    },
    andWhere(...args) {
      calls.push(['andWhere', ...args]);
      return this;
    },
    distinct(...args) {
      calls.push(['distinct', ...args]);
      return this;
    },
    async getMany() {
      return [{ id: 'banquet-later', status: 'approved' }];
    },
  };
  const bookingRepository = {
    createQueryBuilder(alias) {
      assert.equal(alias, 'activeBooking');
      return query;
    },
  };
  const manager = {
    async query() { return [{ ready: true }]; },
    getRepository(entity) {
      if (entity === TableEntity) return tableRepository;
      if (entity === Booking) return bookingRepository;
      throw new Error(`Unexpected repository: ${entity?.name}`);
    },
  };

  await service.synchronizeTableForDate(manager, table.id, kyivDate());

  assert.equal(table.status, 'reserved');
  assert.deepEqual(saves, ['reserved']);
  assert.ok(calls.some((call) =>
    call[0] === 'leftJoin' &&
    call[1] === 'activeBooking.tableAssignments' &&
    call[2] === 'activeAssignment'
  ));
  assert.ok(calls.some((call) =>
    call[0] === 'where' &&
    String(call[1]).includes('activeAssignedTable.id = :tableId')
  ));
});
