require('reflect-metadata');

const assert = require('node:assert/strict');
const test = require('node:test');
const { ServiceUnavailableException } = require('@nestjs/common');

const {
  BookingTableLockService,
} = require('../dist/bookings/booking-table-lock.service.js');

function buildService({ lockError = null } = {}) {
  const calls = [];
  const manager = { marker: 'same-connection-manager' };
  const runner = {
    manager,
    async connect() {
      calls.push(['connect']);
    },
    async startTransaction() {
      calls.push(['startTransaction']);
    },
    async query(sql, params) {
      calls.push(['query', sql, params || null]);
      if (lockError && String(sql).includes('pg_advisory_xact_lock')) {
        throw lockError;
      }
      return [];
    },
    async commitTransaction() {
      calls.push(['commitTransaction']);
    },
    async rollbackTransaction() {
      calls.push(['rollbackTransaction']);
    },
    async release() {
      calls.push(['release']);
    },
  };

  const dataSource = {
    createQueryRunner() {
      calls.push(['createQueryRunner']);
      return runner;
    },
  };
  const tables = {
    async findOne() {
      return { id: 'table-5', tableNumber: '5' };
    },
  };

  return {
    calls,
    manager,
    service: new BookingTableLockService(
      dataSource,
      tables,
      {},
      {},
      {},
    ),
  };
}

test('public guest create lock and protected work use the same transaction connection', async () => {
  const { service, calls, manager } = buildService();
  let receivedManager = null;

  const result = await service.withGuestCreateTransaction(
    {
      tableId: 'table-5',
      tableNumber: '5',
      bookingDate: '2026-09-25',
    },
    async (transactionManager) => {
      receivedManager = transactionManager;
      calls.push(['work']);
      return 'created';
    },
  );

  assert.equal(result, 'created');
  assert.equal(receivedManager, manager);

  const lockTimeoutCall = calls.find(
    (call) => call[0] === 'query' && String(call[1]).includes('SET LOCAL lock_timeout'),
  );
  assert.ok(lockTimeoutCall);

  const advisoryCall = calls.find(
    (call) => call[0] === 'query' && String(call[1]).includes('pg_advisory_xact_lock'),
  );
  assert.deepEqual(advisoryCall?.[2], ['table-5', '2026-09-25']);

  const resetTimeoutIndex = calls.findIndex(
    (call) => call[0] === 'query' && String(call[1]).includes("lock_timeout = '0'"),
  );
  const workIndex = calls.findIndex((call) => call[0] === 'work');
  assert.ok(resetTimeoutIndex > calls.indexOf(advisoryCall));
  assert.ok(resetTimeoutIndex < workIndex);

  assert.ok(
    calls.findIndex((call) => call[0] === 'startTransaction') <
      workIndex,
  );
  assert.ok(
    calls.findIndex((call) => call[0] === 'work') <
      calls.findIndex((call) => call[0] === 'commitTransaction'),
  );
  assert.equal(calls.at(-1)?.[0], 'release');
});

test('guest create advisory-lock timeout rolls back and returns a temporary-unavailable error', async () => {
  const lockError = Object.assign(new Error('canceling statement due to lock timeout'), {
    code: '55P03',
  });
  const { service, calls } = buildService({ lockError });
  let workCalls = 0;

  await assert.rejects(
    () =>
      service.withGuestCreateTransaction(
        {
          tableId: 'table-5',
          tableNumber: '5',
          bookingDate: '2026-09-25',
        },
        async () => {
          workCalls += 1;
          return 'must-not-run';
        },
      ),
    (error) =>
      error instanceof ServiceUnavailableException &&
      error.message === 'Система бронювання зайнята. Спробуйте ще раз.',
  );

  assert.equal(workCalls, 0);
  assert.ok(calls.some((call) => call[0] === 'rollbackTransaction'));
  assert.equal(calls.at(-1)?.[0], 'release');
});
