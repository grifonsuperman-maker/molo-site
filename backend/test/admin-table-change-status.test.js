const assert = require('node:assert/strict');
const test = require('node:test');

const {
  AdminTableChangeApprovalService,
} = require('../dist/bookings/admin-table-change-approval.service.js');
const { Booking } = require('../dist/bookings/entities/booking.entity.js');
const { TableEntity } = require('../dist/tables/entities/table.entity.js');

function buildManager(table, activeBookings) {
  const saves = [];
  const tableRepository = {
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

test('old table stays reserved when another approved booking remains today', async () => {
  const service = new AdminTableChangeApprovalService({});
  const table = { id: 'old-table', status: 'free' };
  const { manager, saves } = buildManager(table, [{ status: 'approved' }]);

  await service.synchronizeTableForDate(
    manager,
    table.id,
    service.kyivDate(),
    table,
  );

  assert.equal(table.status, 'reserved');
  assert.deepEqual(saves, ['reserved']);
});

test('old table becomes pending when only a pending booking remains today', async () => {
  const service = new AdminTableChangeApprovalService({});
  const table = { id: 'old-table', status: 'reserved' };
  const { manager, saves } = buildManager(table, [{ status: 'pending' }]);

  await service.synchronizeTableForDate(
    manager,
    table.id,
    service.kyivDate(),
    table,
  );

  assert.equal(table.status, 'pending');
  assert.deepEqual(saves, ['pending']);
});

test('old table becomes free only when no active booking remains today', async () => {
  const service = new AdminTableChangeApprovalService({});
  const table = { id: 'old-table', status: 'reserved' };
  const { manager, saves } = buildManager(table, []);

  await service.synchronizeTableForDate(
    manager,
    table.id,
    service.kyivDate(),
    table,
  );

  assert.equal(table.status, 'free');
  assert.deepEqual(saves, ['free']);
});
