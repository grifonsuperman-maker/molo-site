const assert = require('node:assert/strict');
const test = require('node:test');

const { TablesService } = require('../dist/tables/tables.service.js');

function buildService(table, activeBookings = []) {
  const savedStatuses = [];
  const tableRepository = {
    findOne: async () => table,
    save: async (value) => {
      savedStatuses.push(value.status);
      return value;
    },
  };
  const bookingRepository = {
    find: async () => activeBookings,
  };

  return {
    service: new TablesService(tableRepository, {}, bookingRepository),
    savedStatuses,
  };
}

test('waiter can mark a free table occupied', async () => {
  const table = { id: 'table-1', status: 'free' };
  const { service, savedStatuses } = buildService(table);

  const result = await service.setWaiterStatus(table.id, 'occupied');

  assert.equal(result.status, 'occupied');
  assert.deepEqual(savedStatuses, ['occupied']);
});

test('waiter cannot occupy a closed table', async () => {
  const table = { id: 'table-1', status: 'closed' };
  const { service, savedStatuses } = buildService(table);

  await assert.rejects(
    () => service.setWaiterStatus(table.id, 'occupied'),
    /Закритий Адміністратором стіл/,
  );
  assert.deepEqual(savedStatuses, []);
});

test('waiter cannot overwrite a reserved table with walk-in occupied status', async () => {
  const table = { id: 'table-1', status: 'reserved' };
  const { service, savedStatuses } = buildService(table);

  await assert.rejects(
    () => service.setWaiterStatus(table.id, 'occupied'),
    /активне бронювання/,
  );
  assert.deepEqual(savedStatuses, []);
});

test('free action keeps a checked-in approved booking occupied', async () => {
  const table = { id: 'table-1', status: 'occupied' };
  const { service, savedStatuses } = buildService(table, [
    { status: 'approved', checkedInAt: new Date() },
  ]);

  const result = await service.setWaiterStatus(table.id, 'free');

  assert.equal(result.status, 'occupied');
  assert.deepEqual(savedStatuses, ['occupied']);
});

test('free action restores reserved when an approved booking remains today', async () => {
  const table = { id: 'table-1', status: 'occupied' };
  const { service, savedStatuses } = buildService(table, [
    { status: 'approved', checkedInAt: null },
  ]);

  const result = await service.setWaiterStatus(table.id, 'free');

  assert.equal(result.status, 'reserved');
  assert.deepEqual(savedStatuses, ['reserved']);
});

test('free action restores pending when only a pending booking remains today', async () => {
  const table = { id: 'table-1', status: 'occupied' };
  const { service, savedStatuses } = buildService(table, [
    { status: 'pending', checkedInAt: null },
  ]);

  const result = await service.setWaiterStatus(table.id, 'free');

  assert.equal(result.status, 'pending');
  assert.deepEqual(savedStatuses, ['pending']);
});

test('free action makes a table free when no active booking remains today', async () => {
  const table = { id: 'table-1', status: 'occupied' };
  const { service, savedStatuses } = buildService(table, []);

  const result = await service.setWaiterStatus(table.id, 'free');

  assert.equal(result.status, 'free');
  assert.deepEqual(savedStatuses, ['free']);
});
