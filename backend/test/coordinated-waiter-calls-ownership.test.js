require('reflect-metadata');

const assert = require('node:assert/strict');
const test = require('node:test');

const { createCoordinatedWaiterCallsService } = require('../dist/waiter-calls/coordinated-waiter-calls.provider.js');
const { TableOwnershipService } = require('../dist/tables/table-ownership.service.js');

function harness({ owner = null, failOwnerWrite = false, checkedIn = true, tableStatus = 'occupied' } = {}) {
  const table = { id: 'table-1', status: tableStatus, assignedWaiterId: owner };
  const booking = { id: 'booking-1', table, status: 'approved', checkedInAt: checkedIn ? new Date() : null };
  const call = {
    id: 'call-1', booking, tableId: table.id, tableNumber: '1', clientName: 'Гість',
    waiterId: null, waiterName: null, assignmentActive: true, status: 'new',
    createdAt: new Date(), acceptedAt: null, closedAt: null,
  };
  let transactions = 0;
  let rawAcceptCalls = 0;
  const repository = {
    async findOne() { return call; },
    async save(value) { Object.assign(call, value); return value; },
  };
  const tables = {
    async findOne() { return table; },
    async find() { return [table]; },
    async save(value) {
      if (failOwnerWrite) throw new Error('simulated owner write failure');
      Object.assign(table, value);
      return value;
    },
  };
  const manager = {
    getRepository(entity) {
      if (entity.name === 'TableEntity') return tables;
      if (entity.name === 'WaiterCallRecord') return repository;
      throw new Error(`Unexpected repository ${entity.name}`);
    },
  };
  const dataSource = {
    getRepository(entity) { return manager.getRepository(entity); },
    async transaction(work) { transactions++; return work(manager); },
  };
  const raw = { async accept() { rawAcceptCalls++; throw new Error('nested transaction'); } };
  const service = createCoordinatedWaiterCallsService(raw, dataSource, new TableOwnershipService(dataSource));
  return { service, table, call, transactions: () => transactions, rawAcceptCalls: () => rawAcceptCalls };
}

test('accept writes call and owner through the same transaction manager', async () => {
  const h = harness();
  const result = await h.service.accept('call-1', { waiterId: 'waiter-1', waiterName: 'Андрій' });
  assert.equal(result.call.status, 'accepted');
  assert.equal(h.table.assignedWaiterId, 'waiter-1');
  assert.equal(h.transactions(), 1);
  assert.equal(h.rawAcceptCalls(), 0);
});

test('a different waiter cannot accept an owned table call', async () => {
  const h = harness({ owner: 'waiter-1' });
  await assert.rejects(
    () => h.service.accept('call-1', { waiterId: 'waiter-2', waiterName: 'Сергій' }),
    /закріплено за іншим офіціантом/,
  );
  assert.equal(h.call.status, 'new');
  assert.equal(h.rawAcceptCalls(), 0);
});

test('owner write failure propagates instead of committing an independent call transaction', async () => {
  const h = harness({ failOwnerWrite: true });
  await assert.rejects(
    () => h.service.accept('call-1', { waiterId: 'waiter-1', waiterName: 'Андрій' }),
    /simulated owner write failure/,
  );
  assert.equal(h.transactions(), 1);
  assert.equal(h.rawAcceptCalls(), 0);
});

test('a stale call cannot be accepted before arrival and cannot claim its table', async () => {
  const h = harness({ checkedIn: false });
  await assert.rejects(
    () => h.service.accept('call-1', { waiterId: 'waiter-1', waiterName: 'Андрій' }),
    /чинному відвідуванню/,
  );
  assert.equal(h.call.status, 'new');
  assert.equal(h.table.assignedWaiterId, null);
});

test('a call from a released or cleaning table cannot be accepted or take ownership', async () => {
  for (const tableStatus of ['free', 'pending', 'reserved', 'cleaning', 'closed']) {
    const h = harness({ tableStatus });
    await assert.rejects(
      () => h.service.accept('call-1', { waiterId: 'waiter-1', waiterName: 'Андрій' }),
      /не належить зайнятому столу/,
    );
    assert.equal(h.call.status, 'new');
    assert.equal(h.table.assignedWaiterId, null);
    assert.equal(h.rawAcceptCalls(), 0);
  }
});
