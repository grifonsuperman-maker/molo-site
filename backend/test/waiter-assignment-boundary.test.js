require('reflect-metadata');

const assert = require('node:assert/strict');
const test = require('node:test');
const { getMetadataArgsStorage } = require('typeorm');

const { createCoordinatedWaiterCallsService } = require('../dist/waiter-calls/coordinated-waiter-calls.provider.js');
const { TableEntity } = require('../dist/tables/entities/table.entity.js');
const { TableOwnershipService } = require('../dist/tables/table-ownership.service.js');

function kyivToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const value = (type) => parts.find((part) => part.type === type)?.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function harness({ checkedIn = false, owner = null, status = 'occupied', failOwnerWrite = false, bookingDate = kyivToday() } = {}) {
  const table = { id: 'table-1', tableNumber: '1', assignedWaiterId: owner, status };
  const booking = { id: 'booking-1', table, status: 'approved', bookingDate, checkedInAt: checkedIn ? new Date() : null };
  const calls = [];
  const manager = {
    getRepository(entity) {
      if (entity.name === 'Booking') return { async findOne() { return booking; } };
      if (entity.name === 'TableEntity') {
        return {
          async findOne() { return table; },
          async find() { return [table]; },
          async save() {
            calls.push('table.save');
            if (failOwnerWrite) throw new Error('owner write failed');
            return table;
          },
        };
      }
      throw new Error(`Unexpected repository ${entity.name}`);
    },
  };
  const dataSource = {
    getRepository(entity) { return manager.getRepository(entity); },
    async transaction(action) { calls.push('transaction'); return action(manager); },
  };
  const raw = {
    async assign() { calls.push('raw.assign'); throw new Error('legacy memory assignment must not be used'); },
  };
  const service = createCoordinatedWaiterCallsService(raw, dataSource, new TableOwnershipService(dataSource));
  const dto = { bookingId: booking.id, tableId: table.id, waiterId: 'waiter-1', waiterName: 'Андрій' };
  return { service, table, booking, calls, dto };
}

test('direct assignment before actual check-in does not claim a table', async () => {
  const h = harness();
  await assert.rejects(() => h.service.assign(h.dto), /лише після приходу гостей/);
  assert.ok(!h.calls.includes('raw.assign'));
  assert.equal(h.table.assignedWaiterId, null);
});

test('checked-in waiter uses durable ownership and never publishes a second in-memory assignment', async () => {
  const h = harness({ checkedIn: true });
  const result = await h.service.assign(h.dto);
  assert.equal(result.assignment.waiterId, 'waiter-1');
  assert.equal(h.table.assignedWaiterId, 'waiter-1');
  assert.deepEqual(h.calls, ['transaction', 'table.save']);
});

test('cannot assign a future or previous booking on an independently occupied table', async () => {
  for (const bookingDate of ['2000-01-01', '2099-01-01']) {
    const h = harness({ checkedIn: true, bookingDate });
    await assert.rejects(() => h.service.assign(h.dto), /бронюванням на сьогодні/);
    assert.equal(h.table.assignedWaiterId, null);
    assert.ok(!h.calls.includes('raw.assign'));
  }
});

test('another waiter cannot assign a call on an already owned table', async () => {
  const h = harness({ checkedIn: true, owner: 'waiter-2' });
  await assert.rejects(() => h.service.assign(h.dto), /закріплено за іншим офіціантом/);
  assert.ok(!h.calls.includes('raw.assign'));
});

test('failed owner write cannot publish a second assignment', async () => {
  const h = harness({ checkedIn: true, failOwnerWrite: true });
  await assert.rejects(() => h.service.assign(h.dto), /owner write failed/);
  assert.ok(!h.calls.includes('raw.assign'));
});

test('TypeORM metadata retains the waiter FK and index created by the migration', () => {
  const metadata = getMetadataArgsStorage();
  const relation = metadata.relations.find((item) => item.target === TableEntity && item.propertyName === 'assignedWaiter');
  const join = metadata.joinColumns.find((item) => item.target === TableEntity && item.propertyName === 'assignedWaiter');
  const index = metadata.indices.find((item) => item.target === TableEntity && item.name === 'IDX_tables_assigned_waiter');
  assert.ok(relation, 'staff relation must remain visible to schema synchronization');
  assert.equal(relation.options.onDelete, 'SET NULL');
  assert.equal(relation.options.nullable, true);
  assert.equal(join.name, 'assigned_waiter_id');
  assert.equal(join.foreignKeyConstraintName, 'FK_tables_assigned_waiter');
  assert.deepEqual(index.columns, ['assignedWaiterId']);
});
