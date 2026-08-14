const assert = require('node:assert/strict');
const test = require('node:test');
const { UnauthorizedException } = require('@nestjs/common');

const {
  StaffPinThrottleService,
} = require('../dist/staff/staff-pin-throttle.service.js');

function createSharedDatabase() {
  return {
    attempts: new Map(),
  };
}

class FakeDataSource {
  constructor(shared) {
    this.shared = shared;
  }

  async query(sql, params = []) {
    if (sql.includes('DELETE FROM "staff_pin_attempts"') && params.length === 0) {
      const now = Date.now();
      const cutoff = now - 24 * 60 * 60 * 1000;
      for (const [key, value] of this.shared.attempts) {
        const lockedUntil = value.locked_until
          ? new Date(value.locked_until).getTime()
          : 0;
        if (value.updated_at.getTime() < cutoff && lockedUntil <= now) {
          this.shared.attempts.delete(key);
        }
      }
      return [];
    }

    if (sql.includes('INSERT INTO "staff_pin_attempts"')) {
      const [scope, subjectHash, windowMs, maxAttempts, lockMs] = params;
      const key = `${scope}|${subjectHash}`;
      const now = Date.now();
      const current = this.shared.attempts.get(key);
      const currentLock = current?.locked_until
        ? new Date(current.locked_until).getTime()
        : 0;

      if (current && currentLock > now) {
        return [];
      }

      const reset =
        !current ||
        current.window_started_at.getTime() <= now - Number(windowMs) ||
        (currentLock > 0 && currentLock <= now);
      const attemptCount = reset ? 1 : Number(current.attempt_count) + 1;
      const lockedUntil =
        !reset && attemptCount >= Number(maxAttempts)
          ? new Date(now + Number(lockMs))
          : null;
      const row = {
        attempt_count: attemptCount,
        window_started_at: reset ? new Date(now) : current.window_started_at,
        locked_until: lockedUntil,
        updated_at: new Date(now),
      };
      this.shared.attempts.set(key, row);
      return [
        {
          attempt_count: row.attempt_count,
          locked_until: row.locked_until,
        },
      ];
    }

    if (sql.includes('SELECT "locked_until"')) {
      const value = this.shared.attempts.get(`${params[0]}|${params[1]}`);
      return value ? [{ locked_until: value.locked_until }] : [];
    }

    if (sql.includes('UPDATE "staff_pin_attempts"')) {
      const [scope, subjectHash, maxAttempts] = params;
      const key = `${scope}|${subjectHash}`;
      const current = this.shared.attempts.get(key);
      if (!current) return [];

      const attemptCount = Math.max(Number(current.attempt_count) - 1, 0);
      current.attempt_count = attemptCount;
      if (attemptCount < Number(maxAttempts)) {
        current.locked_until = null;
      }
      current.updated_at = new Date();
      this.shared.attempts.set(key, current);
      return [{ attempt_count: attemptCount }];
    }

    if (sql.includes('DELETE FROM "staff_pin_attempts"')) {
      this.shared.attempts.delete(`${params[0]}|${params[1]}`);
      return [];
    }

    throw new Error(`Unexpected SQL in test: ${sql}`);
  }
}

function executeWrongPin(service, subject, calls) {
  return service.execute({
    scope: 'pin-login',
    subject,
    credentialFailureMessage: 'Невірний працівник або PIN',
    action: async () => {
      calls.count += 1;
      throw new UnauthorizedException('Невірний працівник або PIN');
    },
  });
}

test('five wrong PINs persist a 15-minute lock across service instances', async () => {
  const shared = createSharedDatabase();
  const firstService = new StaffPinThrottleService(new FakeDataSource(shared));
  const secondService = new StaffPinThrottleService(new FakeDataSource(shared));
  const calls = { count: 0 };

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    await assert.rejects(
      () => executeWrongPin(firstService, 'staff-1', calls),
      /Невірний працівник або PIN/,
    );
  }

  await assert.rejects(
    () => executeWrongPin(firstService, 'staff-1', calls),
    /заблоковано на 15 хв/,
  );

  await assert.rejects(
    () => executeWrongPin(secondService, 'staff-1', calls),
    /Повторіть через/,
  );

  assert.equal(calls.count, 5);
});

test('parallel guesses share the atomic database attempt counter', async () => {
  const shared = createSharedDatabase();
  const firstService = new StaffPinThrottleService(new FakeDataSource(shared));
  const secondService = new StaffPinThrottleService(new FakeDataSource(shared));
  const calls = { count: 0 };

  const results = await Promise.allSettled([
    ...Array.from({ length: 3 }, () =>
      executeWrongPin(firstService, 'staff-2', calls),
    ),
    ...Array.from({ length: 3 }, () =>
      executeWrongPin(secondService, 'staff-2', calls),
    ),
  ]);

  assert.equal(results.every((result) => result.status === 'rejected'), true);
  assert.equal(calls.count, 5);
});

test('successful credential verification clears previous failures', async () => {
  const shared = createSharedDatabase();
  const service = new StaffPinThrottleService(new FakeDataSource(shared));
  const calls = { count: 0 };

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await assert.rejects(
      () => executeWrongPin(service, 'staff-3', calls),
      /Невірний працівник або PIN/,
    );
  }

  const result = await service.execute({
    scope: 'pin-login',
    subject: 'staff-3',
    credentialFailureMessage: 'Невірний працівник або PIN',
    action: async () => 'staff-token',
  });

  assert.equal(result, 'staff-token');
  assert.equal(shared.attempts.size, 0);
});

test('correct PIN rejected only because shift is closed clears failures', async () => {
  const shared = createSharedDatabase();
  const service = new StaffPinThrottleService(new FakeDataSource(shared));
  const calls = { count: 0 };

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await assert.rejects(
      () => executeWrongPin(service, 'staff-4', calls),
      /Невірний працівник або PIN/,
    );
  }

  await assert.rejects(
    () =>
      service.execute({
        scope: 'pin-login',
        subject: 'staff-4',
        credentialFailureMessage: 'Невірний працівник або PIN',
        resetOnErrorMessage: 'Працівника не додано на зміну',
        action: async () => {
          throw new UnauthorizedException('Працівника не додано на зміну');
        },
      }),
    /Працівника не додано на зміну/,
  );

  assert.equal(shared.attempts.size, 0);
});

test('non-credential failures release their reserved attempt', async () => {
  const shared = createSharedDatabase();
  const service = new StaffPinThrottleService(new FakeDataSource(shared));

  await assert.rejects(
    () =>
      service.execute({
        scope: 'pin-login',
        subject: 'staff-5',
        credentialFailureMessage: 'Невірний працівник або PIN',
        action: async () => {
          throw new Error('database unavailable');
        },
      }),
    /database unavailable/,
  );

  assert.equal(shared.attempts.size, 0);
});

test('expired attempt windows restart from the first attempt', async () => {
  const shared = createSharedDatabase();
  const dataSource = new FakeDataSource(shared);
  const service = new StaffPinThrottleService(dataSource);
  const calls = { count: 0 };

  await assert.rejects(() => executeWrongPin(service, 'staff-6', calls));

  const row = [...shared.attempts.values()][0];
  row.attempt_count = 4;
  row.window_started_at = new Date(Date.now() - 16 * 60 * 1000);

  await assert.rejects(
    () => executeWrongPin(service, 'staff-6', calls),
    /Невірний працівник або PIN/,
  );

  const resetRow = [...shared.attempts.values()][0];
  assert.equal(resetRow.attempt_count, 1);
  assert.equal(resetRow.locked_until, null);
});

test('different login subjects keep isolated counters', async () => {
  const shared = createSharedDatabase();
  const service = new StaffPinThrottleService(new FakeDataSource(shared));
  const firstCalls = { count: 0 };
  const secondCalls = { count: 0 };

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    await assert.rejects(() => executeWrongPin(service, 'staff-a', firstCalls));
  }

  await assert.rejects(
    () => executeWrongPin(service, 'staff-a', firstCalls),
    /заблоковано на 15 хв/,
  );

  await assert.rejects(
    () => executeWrongPin(service, 'staff-b', secondCalls),
    /Невірний працівник або PIN/,
  );

  assert.equal(firstCalls.count, 5);
  assert.equal(secondCalls.count, 1);
});
