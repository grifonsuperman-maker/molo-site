const assert = require('node:assert/strict');
const test = require('node:test');

const {
  StaffPinThrottleService,
} = require('../dist/staff/staff-pin-throttle.service.js');

function createDataSource() {
  const observed = {
    cleanupParams: null,
    reserveCountSql: null,
    reserveCountParams: null,
  };

  const manager = {
    query: async (sql, params = []) => {
      if (sql.includes('pg_advisory_xact_lock')) return [];
      if (sql.includes('SELECT "locked_until"')) return [];
      if (sql.includes('SELECT COUNT(*)::int AS "count"')) {
        observed.reserveCountSql = sql;
        observed.reserveCountParams = params;
        return [{ count: 0 }];
      }
      if (sql.includes('INSERT INTO "staff_pin_attempts"')) {
        return [{ id: 1 }];
      }
      throw new Error(`Unexpected transaction SQL: ${sql}`);
    },
  };

  const dataSource = {
    transaction: async (callback) => callback(manager),
    query: async (sql, params = []) => {
      if (
        sql.includes('DELETE FROM "staff_pin_attempts"') &&
        sql.includes('"locked_until" IS NULL')
      ) {
        observed.cleanupParams = params;
        return [];
      }
      if (
        sql.includes('DELETE FROM "staff_pin_attempts"') &&
        sql.includes('"id" <= $3')
      ) {
        return [];
      }
      throw new Error(`Unexpected direct SQL: ${sql}`);
    },
  };

  return { dataSource, observed };
}

test('pending reservations cannot be cleaned while they are still inside the 15-minute security window', async () => {
  const { dataSource, observed } = createDataSource();
  const service = new StaffPinThrottleService(dataSource);

  const result = await service.execute({
    scope: 'pin-login',
    subject: 'staff-window-test',
    credentialFailureMessage: 'Невірний працівник або PIN',
    action: async () => 'access-token',
  });

  assert.equal(result, 'access-token');
  assert.ok(observed.cleanupParams);
  assert.ok(observed.reserveCountParams);

  const pendingRetentionMs = Number(observed.cleanupParams[0]);
  const failedWindowMs = Number(observed.cleanupParams[1]);
  const reservationWindowMs = Number(observed.reserveCountParams[2]);

  assert.equal(failedWindowMs, 15 * 60 * 1000);
  assert.equal(reservationWindowMs, failedWindowMs);
  assert.ok(pendingRetentionMs > failedWindowMs);
  assert.match(observed.reserveCountSql, /"reserved_at" >= NOW\(\)/);
  assert.match(observed.reserveCountSql, /"failed_at" >= NOW\(\)/);
});
