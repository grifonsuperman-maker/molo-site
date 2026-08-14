const assert = require('node:assert/strict');
const test = require('node:test');
const { UnauthorizedException } = require('@nestjs/common');

const {
  StaffPinThrottleService,
} = require('../dist/staff/staff-pin-throttle.service.js');

function createSharedDatabase() {
  return {
    attempts: new Map(),
    locks: new Map(),
  };
}

class FakeDataSource {
  constructor(shared) {
    this.shared = shared;
  }

  async transaction(callback) {
    const manager = new FakeManager(this.shared);
    try {
      return await callback(manager);
    } finally {
      manager.releaseAll();
    }
  }
}

class FakeManager {
  constructor(shared) {
    this.shared = shared;
    this.releases = [];
  }

  async query(sql, params = []) {
    if (sql.includes('pg_advisory_xact_lock')) {
      const key = `${params[0]}|${params[1]}`;
      this.releases.push(await this.acquire(key));
      return [];
    }

    if (sql.includes('DELETE FROM "staff_pin_attempts"') && params.length === 0) {
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      for (const [key, value] of this.shared.attempts) {
        const lockExpired =
          !value.locked_until || new Date(value.locked_until).getTime() <= Date.now();
        if (value.updated_at.getTime() < cutoff && lockExpired) {
          this.shared.attempts.delete(key);
        }
      }
      return [];
    }

    if (sql.includes('SELECT "failed_attempts"')) {
      const value = this.shared.attempts.get(`${params[0]}|${params[1]}`);
      return value ? [{ ...value }] : [];
    }

    if (sql.includes('DELETE FROM "staff_pin_attempts"')) {
      this.shared.attempts.delete(`${params[0]}|${params[1]}`);
      return [];
    }

    if (sql.includes('INSERT INTO "staff_pin_attempts"')) {
      const [scope, subjectHash, failedAttempts, windowStartedAt, lockedUntil] = params;
      this.shared.attempts.set(`${scope}|${subjectHash}`, {
        failed_attempts: failedAttempts,
        window_started_at: windowStartedAt,
        locked_until: lockedUntil,
        updated_at: new Date(),
      });
      return [];
    }

    throw new Error(`Unexpected SQL in test: ${sql}`);
  }

  async acquire(key) {
    const previous = this.shared.locks.get(key) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => {
      release = resolve;
    });
    const queued = previous.catch(() => undefined).then(() => current);
    this.shared.locks.set(key, queued);

    await previous.catch(() => undefined);

    return () => {
      release();
      if (this.shared.locks.get(key) === queued) {
        this.shared.locks.delete(key);
      }
    };
  }

  releaseAll() {
    for (const release of this.releases.reverse()) release();
    this.releases = [];
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

test('parallel guesses are serialized through the shared database lock', async () => {
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
    /заблоковано on 15 хв|заблоковано на 15 хв/,
  );

  await assert.rejects(
    () => executeWrongPin(service, 'staff-b', secondCalls),
    /Невірний працівник або PIN/,
  );

  assert.equal(firstCalls.count, 5);
  assert.equal(secondCalls.count, 1);
});
