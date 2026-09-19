const assert = require('node:assert/strict');
const test = require('node:test');

const { TablesService } = require('../dist/tables/tables.service.js');
const { TableOwnershipService } = require('../dist/tables/table-ownership.service.js');

const andrii = { role: 'waiter', staffId: 'waiter-1', name: 'Андрій' };
const serhii = { role: 'waiter', staffId: 'waiter-2', name: 'Сергій' };
const admin = { role: 'admin', staffId: 'admin-1' };

function buildService(table, activeBookings = []) {
  const savedStatuses = [];
  const tableRepository = {
    findOne: async () => table,
    save: async (value) => {
      savedStatuses.push(value.status);
      return value;
    },
  };
  const bookingRepository = { find: async () => activeBookings };
  const manager = {
    getRepository(entity) {
      if (entity.name === 'TableEntity') return tableRepository;
      if (entity.name === 'Booking') return bookingRepository;
      throw new Error(`Unexpected repository ${entity.name}`);
    },
  };
  const dataSource = { transaction: async (work) => work(manager) };
  const ownership = new TableOwnershipService(dataSource);
  return {
    service: new TablesService(tableRepository, {}, bookingRepository, dataSource, ownership),
    savedStatuses,
    table,
  };
}

test('first waiter atomically claims a free walk-in table', async () => {
  const table = { id: 'table-1', status: 'free', assignedWaiterId: null };
  const { service, savedStatuses } = buildService(table);
  const result = await service.setWaiterStatus(table.id, 'occupied', andrii);
  assert.equal(result.status, 'occupied');
  assert.equal(result.assignedWaiterId, andrii.staffId);
  assert.deepEqual(savedStatuses, ['occupied']);
});

test('another waiter cannot occupy, free, clean, or change an owned table using alternate endpoints', async () => {
  const table = { id: 'table-1', status: 'occupied', assignedWaiterId: andrii.staffId };
  const { service, savedStatuses } = buildService(table);
  for (const action of [
    () => service.setWaiterStatus(table.id, 'occupied', serhii),
    () => service.setWaiterStatus(table.id, 'free', serhii),
    () => service.markOccupied(table.id, serhii),
    () => service.markCleaning(table.id, serhii),
    () => service.markFree(table.id, serhii),
  ]) {
    await assert.rejects(action(), /закріплено за іншим офіціантом/);
  }
  assert.equal(table.assignedWaiterId, andrii.staffId);
  assert.equal(table.status, 'occupied');
  assert.deepEqual(savedStatuses, []);
});

test('waiter cannot occupy a closed table', async () => {
  const table = { id: 'table-1', status: 'closed', assignedWaiterId: null };
  const { service, savedStatuses } = buildService(table);
  await assert.rejects(
    () => service.setWaiterStatus(table.id, 'occupied', andrii),
    /Закритий Адміністратором стіл/,
  );
  assert.deepEqual(savedStatuses, []);
});

test('waiter cannot overwrite a reserved table with walk-in occupied status', async () => {
  const table = { id: 'table-1', status: 'reserved', assignedWaiterId: null };
  const { service, savedStatuses } = buildService(table);
  await assert.rejects(
    () => service.setWaiterStatus(table.id, 'occupied', andrii),
    /активне бронювання/,
  );
  assert.deepEqual(savedStatuses, []);
});

test('free action keeps a checked-in approved booking occupied and retains ownership', async () => {
  const table = { id: 'table-1', status: 'occupied', assignedWaiterId: andrii.staffId };
  const { service, savedStatuses } = buildService(table, [
    { status: 'approved', checkedInAt: new Date() },
  ]);
  const result = await service.setWaiterStatus(table.id, 'free', andrii);
  assert.equal(result.status, 'occupied');
  assert.equal(result.assignedWaiterId, andrii.staffId);
  assert.deepEqual(savedStatuses, ['occupied']);
});

test('free action restores reserved when an approved booking remains today', async () => {
  const table = { id: 'table-1', status: 'occupied', assignedWaiterId: andrii.staffId };
  const { service, savedStatuses } = buildService(table, [
    { status: 'approved', checkedInAt: null },
  ]);
  const result = await service.setWaiterStatus(table.id, 'free', andrii);
  assert.equal(result.status, 'reserved');
  assert.equal(result.assignedWaiterId, null);
  assert.deepEqual(savedStatuses, ['reserved']);
});

test('free action restores pending when only a pending booking remains today', async () => {
  const table = { id: 'table-1', status: 'occupied', assignedWaiterId: andrii.staffId };
  const { service, savedStatuses } = buildService(table, [
    { status: 'pending', checkedInAt: null },
  ]);
  const result = await service.setWaiterStatus(table.id, 'free', andrii);
  assert.equal(result.status, 'pending');
  assert.equal(result.assignedWaiterId, null);
  assert.deepEqual(savedStatuses, ['pending']);
});

test('free action releases ownership for next waiter when no active booking remains', async () => {
  const table = { id: 'table-1', status: 'occupied', assignedWaiterId: andrii.staffId };
  const { service, savedStatuses } = buildService(table);
  const result = await service.setWaiterStatus(table.id, 'free', andrii);
  assert.equal(result.status, 'free');
  assert.equal(result.assignedWaiterId, null);
  await service.setWaiterStatus(table.id, 'occupied', serhii);
  assert.equal(table.assignedWaiterId, serhii.staffId);
  assert.deepEqual(savedStatuses, ['free', 'occupied']);
});

test('Admin and Director may override waiter assignment and free the table', async () => {
  for (const actor of [admin, { role: 'owner', staffId: 'director-1' }]) {
    const table = { id: 'table-1', status: 'occupied', assignedWaiterId: andrii.staffId };
    const { service } = buildService(table);
    await service.setStatus(table.id, 'free', actor);
    assert.equal(table.status, 'free');
    assert.equal(table.assignedWaiterId, null);
  }
});

test('missing waiter identity fails closed without changing the table', async () => {
  const table = { id: 'table-1', status: 'free', assignedWaiterId: null };
  const { service, savedStatuses } = buildService(table);
  await assert.rejects(() => service.setWaiterStatus(table.id, 'occupied'), /права працівника/);
  await assert.rejects(() => service.setWaiterStatus(table.id, 'occupied', { role: 'waiter' }), /визначити офіціанта/);
  assert.deepEqual(savedStatuses, []);
});
