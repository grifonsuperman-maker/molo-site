const assert = require('node:assert/strict');
const test = require('node:test');
const { UnauthorizedException } = require('@nestjs/common');

const {
  StaffPinThrottleService,
} = require('../dist/staff/staff-pin-throttle.service.js');

function createCleanupFailingDataSource() {
  const manager = {
    query: async (sql) => {
      if (sql.includes('pg_advisory_xact_lock')) return [];
      if (sql.includes('SELECT "locked_until"')) return [];
      if (sql.includes('SELECT COUNT(*)::int AS "count"')) return [{ count: 0 }];
      if (sql.includes('INSERT INTO "staff_pin_attempts"')) return [{ id: 1 }];
      throw new Error(`Unexpected transaction SQL: ${sql}`);
    },
  };

  return {
    transaction: async (callback) => callback(manager),
    query: async (sql) => {
      if (
        sql.includes('DELETE FROM "staff_pin_attempts"') &&
        sql.includes('"locked_until" IS NULL')
      ) {
        return [];
      }
      if (sql.includes('"id" <= $3')) {
        throw new Error('throttle cleanup unavailable');
      }
      throw new Error(`Unexpected direct SQL: ${sql}`);
    },
  };
}

test('successful auth result survives throttle cleanup failure', async () => {
  const service = new StaffPinThrottleService(createCleanupFailingDataSource());

  const result = await service.execute({
    scope: 'telegram-link',
    subject: 'invite-token',
    credentialFailureMessage: 'Невірний PIN',
    action: async () => ({ accessToken: 'token-after-link' }),
  });

  assert.deepEqual(result, { accessToken: 'token-after-link' });
});

test('verified PIN outside shift keeps its original error if throttle cleanup fails', async () => {
  const service = new StaffPinThrottleService(createCleanupFailingDataSource());

  await assert.rejects(
    () =>
      service.execute({
        scope: 'pin-login',
        subject: 'staff-id',
        credentialFailureMessage: 'Невірний працівник або PIN',
        resetOnErrorMessage: 'Працівника не додано на зміну',
        action: async () => {
          throw new UnauthorizedException('Працівника не додано на зміну');
        },
      }),
    /Працівника не додано на зміну/,
  );
});
