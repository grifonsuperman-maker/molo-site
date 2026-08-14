const assert = require('node:assert/strict');
const test = require('node:test');
const { UnauthorizedException } = require('@nestjs/common');

const {
  StaffPinThrottleService,
} = require('../dist/staff/staff-pin-throttle.service.js');

function createSharedDatabase() {
  return {
    attempts: [],
    nextId: 1,
    locks: new Map(),
  };
}

function rowsFor(shared, scope, subjectHash) {
  return shared.attempts.filter(
    (row) => row.scope === scope && row.subject_hash === subjectHash,
  );
}

async function runQuery(shared, sql, params = []) {
  const now = Date.now();

  if (
    sql.includes('DELETE FROM "staff_pin_attempts"') &&
    sql.includes('"locked_until" IS NULL') &&
    params.length === 2
  ) {
    const pendingTtl = Number(params[0]);
    const failedWindow = Number(params[1]);
    shared.attempts = shared.attempts.filter((row) => {
      const lockActive = row.locked_until && row.locked_until.getTime() > now;
      if (lockActive) return true;
      if (row.status === 'pending') {
        return row.reserved_at.getTime() > now - pendingTtl;
      }
      if (row.status === 'failed' && row.failed_at) {
        return row.failed_at.getTime() > now - failedWindow;
      }
      return true;
    });
    return [];
  }

  if (sql.includes('SELECT "locked_until"') && sql.includes('> NOW()')) {
    const [scope, subjectHash] = params;
    const locks = rowsFor(shared, scope, subjectHash)
      .filter((row) => row.locked_until && row.locked_until.getTime() > now)
      .sort((a, b) => b.locked_until.getTime() - a.locked_until.getTime());
    return locks[0] ? [{ locked_until: locks[0].locked_until }] : [];
  }

  if (sql.includes('SELECT COUNT(*)::int AS "count"')) {
    const [scope, subjectHash, windowMs] = params;
    let rows = rowsFor(shared, scope, subjectHash);
    if (sql.includes('"status" = \'failed\'')) {
      rows = rows.filter(
        (row) =>
          row.status === 'failed' &&
          row.failed_at &&
          row.failed_at.getTime() >= now - Number(windowMs),
      );
    }
    return [{ count: rows.length }];
  }

  if (sql.includes('INSERT INTO "staff_pin_attempts"')) {
    const [scope, subjectHash] = params;
    const row = {
      id: shared.nextId++,
      scope,
      subject_hash: subjectHash,
      status: 'pending',
      reserved_at: new Date(now),
      failed_at: null,
      locked_until: null,
      updated_at: new Date(now),
    };
    shared.attempts.push(row);
    return [{ id: row.id }];
  }

  if (sql.includes('SET "status" = \'failed\'')) {
    const [scope, subjectHash, id] = params;
    const row = shared.attempts.find(
      (item) =>
        item.id === Number(id) &&
        item.scope === scope &&
        item.subject_hash === subjectHash &&
        item.status === 'pending',
    );
    if (!row) return [];
    row.status = 'failed';
    row.failed_at = new Date(now);
    row.updated_at = new Date(now);
    return [{ id: row.id }];
  }

  if (sql.includes('SET "locked_until"')) {
    const [scope, subjectHash, id, lockMs] = params;
    const row = shared.attempts.find(
      (item) =>
        item.id === Number(id) &&
        item.scope === scope &&
        item.subject_hash === subjectHash,
    );
    if (!row) return [];
    row.locked_until = new Date(now + Number(lockMs));
    row.updated_at = new Date(now);
    return [];
  }

  if (sql.includes('"id" <= $3')) {
    const [scope, subjectHash, id] = params;
    shared.attempts = shared.attempts.filter(
      (row) =>
        !(
          row.scope === scope &&
          row.subject_hash === subjectHash &&
          row.id <= Number(id)
        ),
    );
    return [];
  }

  if (sql.includes('"id" = $3') && sql.includes('"status" = \'pending\'')) {
    const [scope, subjectHash, id] = params;
    shared.attempts = shared.attempts.filter(
      (row) =>
        !(
          row.scope === scope &&
          row.subject_hash === subjectHash &&
          row.id === Number(id) &&
          row.status === 'pending'
        ),
    );
    return [];
  }

  throw new Error(`Unexpected SQL in test: ${sql}`);
}

class FakeDataSource {
  constructor(shared) {
    this.shared = shared;
  }

  query(sql, params = []) {
    return runQuery(this.shared, sql, params);
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
    return runQuery(this.shared, sql, params);
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

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
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

test('parallel guesses allow at most five credential checks for one subject', async () => {
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
  assert.equal(shared.attempts.length, 0);
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

  assert.equal(shared.attempts.length, 0);
});

test('a successful request preserves a newer overlapping failed reservation', async () => {
  const shared = createSharedDatabase();
  const firstService = new StaffPinThrottleService(new FakeDataSource(shared));
  const secondService = new StaffPinThrottleService(new FakeDataSource(shared));
  const firstStarted = deferred();
  const secondStarted = deferred();
  const finishFirst = deferred();
  const finishSecond = deferred();

  const first = firstService.execute({
    scope: 'pin-login',
    subject: 'race-success',
    credentialFailureMessage: 'Невірний працівник або PIN',
    action: async () => {
      firstStarted.resolve();
      await finishFirst.promise;
      return 'ok';
    },
  });
  await firstStarted.promise;

  const second = secondService.execute({
    scope: 'pin-login',
    subject: 'race-success',
    credentialFailureMessage: 'Невірний працівник або PIN',
    action: async () => {
      secondStarted.resolve();
      await finishSecond.promise;
      throw new UnauthorizedException('Невірний працівник або PIN');
    },
  });
  await secondStarted.promise;

  finishFirst.resolve();
  assert.equal(await first, 'ok');
  finishSecond.resolve();
  await assert.rejects(() => second, /Невірний працівник або PIN/);

  assert.equal(shared.attempts.length, 1);
  assert.equal(shared.attempts[0].status, 'failed');
});

test('releasing a failed infrastructure request cannot delete a newer reservation', async () => {
  const shared = createSharedDatabase();
  const firstService = new StaffPinThrottleService(new FakeDataSource(shared));
  const secondService = new StaffPinThrottleService(new FakeDataSource(shared));
  const firstStarted = deferred();
  const secondStarted = deferred();
  const finishFirst = deferred();
  const finishSecond = deferred();

  const first = firstService.execute({
    scope: 'pin-login',
    subject: 'race-release',
    credentialFailureMessage: 'Невірний працівник або PIN',
    action: async () => {
      firstStarted.resolve();
      await finishFirst.promise;
      throw new Error('database unavailable');
    },
  });
  await firstStarted.promise;

  const second = secondService.execute({
    scope: 'pin-login',
    subject: 'race-release',
    credentialFailureMessage: 'Невірний працівник або PIN',
    action: async () => {
      secondStarted.resolve();
      await finishSecond.promise;
      throw new UnauthorizedException('Невірний працівник або PIN');
    },
  });
  await secondStarted.promise;

  finishFirst.resolve();
  await assert.rejects(() => first, /database unavailable/);
  assert.equal(shared.attempts.length, 1);
  assert.equal(shared.attempts[0].status, 'pending');

  finishSecond.resolve();
  await assert.rejects(() => second, /Невірний працівник або PIN/);
  assert.equal(shared.attempts.length, 1);
  assert.equal(shared.attempts[0].status, 'failed');
});

test('non-credential failures release only their own pending reservation', async () => {
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

  assert.equal(shared.attempts.length, 0);
});

test('expired failed attempts restart the rolling window', async () => {
  const shared = createSharedDatabase();
  const service = new StaffPinThrottleService(new FakeDataSource(shared));
  const calls = { count: 0 };

  await assert.rejects(() => executeWrongPin(service, 'staff-6', calls));
  shared.attempts[0].failed_at = new Date(Date.now() - 16 * 60 * 1000);
  shared.attempts[0].updated_at = shared.attempts[0].failed_at;

  await assert.rejects(
    () => executeWrongPin(service, 'staff-6', calls),
    /Невірний працівник або PIN/,
  );

  assert.equal(shared.attempts.length, 1);
  assert.equal(shared.attempts[0].status, 'failed');
});

test('different login subjects keep isolated failure rows', async () => {
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
