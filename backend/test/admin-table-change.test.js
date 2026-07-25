const assert = require('node:assert/strict');
const test = require('node:test');

const {
  AdminAttentionService,
} = require('../dist/bookings/admin-attention.service.js');
const {
  BookingTableLockService,
} = require('../dist/bookings/booking-table-lock.service.js');
const { Booking } = require('../dist/bookings/entities/booking.entity.js');
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
