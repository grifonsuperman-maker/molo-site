require('reflect-metadata');

const assert = require('node:assert/strict');
const test = require('node:test');

const { createCoordinatedWaiterCallsService } = require('../dist/waiter-calls/coordinated-waiter-calls.provider.js');
const { TableOwnershipService } = require('../dist/tables/table-ownership.service.js');

function kyivToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const value = (type) => parts.find((part) => part.type === type)?.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function harness({ owner = null, failOwnerWrite = false, checkedIn = true, tableStatus = 'occupied', bookingDate = kyivToday() } = {}) {
  const table = { id: 'table-1', status: tableStatus, assignedWaiterId: owner };
  const booking = {
    id: 'booking-1', table, status: 'approved', bookingDate,
    checkedInAt: checkedIn ? new Date() : null,
  };
  const call = {
    id: 'call-1', booking, tableId: table.id, tableNumber: '1', clientName: 'Гість',
    waiterId: null, waiterName: null, assignmentActive: true, status: 'new',
    createdAt: new Date(), acceptedAt: null, closedAt: null,
  };
  let transactions = 0;
  let rawAcceptCalls = 0;
  const lockOrder = [];
  const repository = {
    async findOne(options) {
      if (options.lock) lockOrder.push('call');
      return call;
    },
    async save(value) { Object.assign(call, value); return value; },
  };
  const bookings = {
    async findOne(options) {
      if (options.lock) lockOrder.push('booking');
      return booking;
    },
  };
  const tables = {
    async findOne(options) {
      if (options.lock) lockOrder.push('table');
      return table;
    },
    async find() { return [table]; },
    async save(value) {
      if (failOwnerWrite) throw new Error('simulated owner write failure');
      Object.assign(table, value);
      return value;
    },
  };
  const manager = {
    getRepository(entity) {
      if (entity.name === 'Booking') return bookings;
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
  return {
    service, table, booking, call, lockOrder,
    transactions: () => transactions, rawAcceptCalls: () => rawAcceptCalls,
  };
}

test('accept uses booking, table, and call locks in that order on one transaction', async () => {
  const h = harness();
  const result = await h.service.accept('call-1', { waiterId: 'waiter-1', waiterName: 'Андрій' });
  assert.equal(result.call.status, 'accepted');
  assert.equal(h.table.assignedWaiterId, 'waiter-1');
  assert.deepEqual(h.lockOrder, ['booking', 'table', 'call']);
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

test('owner write failure propagates from the same transaction as call acceptance', async () => {
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

test('calls from past or future bookings cannot claim a currently occupied table', async () => {
  for (const bookingDate of ['2000-01-01', '2099-01-01']) {
    const h = harness({ bookingDate });
    await assert.rejects(
      () => h.service.accept('call-1', { waiterId: 'waiter-1', waiterName: 'Андрій' }),
      /чинному відвідуванню/,
    );
    assert.equal(h.table.assignedWaiterId, null);
  }
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
