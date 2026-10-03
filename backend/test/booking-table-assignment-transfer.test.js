require('reflect-metadata');

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  bookingTableAssignmentsReady,
  syncSingleTableTransferAssignment,
} = require('../dist/bookings/booking-table-assignment-transfer.js');
const {
  BookingTableAssignment,
} = require('../dist/bookings/entities/booking-table-assignment.entity.js');

const booking = { id: 'booking-1' };
const oldTable = { id: 'table-old', tableNumber: '4' };
const nextTable = { id: 'table-next', tableNumber: '6' };

function managerHarness({ ready = true, assignments = [] } = {}) {
  const saved = [];
  const created = [];
  const calls = [];

  const repository = {
    create(value) {
      created.push(value);
      return { id: 'assignment-created', ...value };
    },
    async save(value) {
      saved.push(value);
      return value;
    },
    createQueryBuilder(alias) {
      assert.equal(alias, 'assignment');
      const query = {
        innerJoinAndSelect(...args) {
          calls.push(['innerJoinAndSelect', ...args]);
          return query;
        },
        where(...args) {
          calls.push(['where', ...args]);
          return query;
        },
        setLock(...args) {
          calls.push(['setLock', ...args]);
          return query;
        },
        async getMany() {
          calls.push(['getMany']);
          return assignments;
        },
      };
      return query;
    },
  };

  const manager = {
    async query(sql) {
      calls.push(['query', sql]);
      return [{ ready }];
    },
    getRepository(entity) {
      assert.equal(entity, BookingTableAssignment);
      return repository;
    },
  };

  return { manager, saved, created, calls };
}

test('assignment readiness is false when schema table is absent', async () => {
  const { manager } = managerHarness({ ready: false });
  assert.equal(await bookingTableAssignmentsReady(manager), false);
});

test('single-table transfer moves the locked primary assignment to the new table', async () => {
  const assignment = {
    id: 'assignment-1',
    booking,
    table: oldTable,
    isPrimary: true,
  };
  const { manager, saved, created, calls } = managerHarness({
    assignments: [assignment],
  });

  await syncSingleTableTransferAssignment(manager, booking, nextTable);

  assert.equal(assignment.table, nextTable);
  assert.deepEqual(saved, [assignment]);
  assert.equal(created.length, 0);
  assert.ok(calls.some((call) =>
    call[0] === 'setLock' &&
    call[1] === 'pessimistic_write' &&
    Array.isArray(call[3]) &&
    call[3].includes('assignment')
  ));
});

test('single-table transfer creates a primary assignment when none exists yet', async () => {
  const { manager, saved, created } = managerHarness({ assignments: [] });

  await syncSingleTableTransferAssignment(manager, booking, nextTable);

  assert.equal(created.length, 1);
  assert.equal(created[0].booking, booking);
  assert.equal(created[0].table, nextTable);
  assert.equal(created[0].isPrimary, true);
  assert.equal(saved.length, 1);
});

test('legacy transfer rejects a real multi-table banquet without changing assignments', async () => {
  const assignments = [
    { id: 'assignment-1', booking, table: oldTable, isPrimary: true },
    { id: 'assignment-2', booking, table: { id: 'table-9' }, isPrimary: false },
  ];
  const { manager, saved, created } = managerHarness({ assignments });

  await assert.rejects(
    () => syncSingleTableTransferAssignment(manager, booking, nextTable),
    /Банкетне бронювання не можна переносити цим способом/,
  );

  assert.equal(saved.length, 0);
  assert.equal(created.length, 0);
  assert.equal(assignments[0].table, oldTable);
});

test('transfer keeps legacy behavior when banquet schema is not adopted', async () => {
  let repositoryReads = 0;
  const manager = {
    async query() {
      return [{ ready: false }];
    },
    getRepository() {
      repositoryReads += 1;
      throw new Error('assignment repository must not be read before schema adoption');
    },
  };

  await syncSingleTableTransferAssignment(manager, booking, nextTable);

  assert.equal(repositoryReads, 0);
});
