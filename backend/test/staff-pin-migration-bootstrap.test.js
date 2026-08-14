const assert = require('node:assert/strict');
const test = require('node:test');

const {
  StaffPinMigrationBootstrapService,
} = require('../dist/staff/staff-pin-migration-bootstrap.service.js');

function createSharedMigrationState() {
  return {
    lockTail: Promise.resolve(),
    activeRuns: 0,
    maxConcurrentRuns: 0,
    runCalls: 0,
  };
}

function createDataSource(shared) {
  let releaseLock = null;
  let transactionActive = false;

  function endTransaction() {
    transactionActive = false;
    if (releaseLock) {
      releaseLock();
      releaseLock = null;
    }
  }

  const queryRunner = {
    connect: async () => {},
    startTransaction: async () => {
      transactionActive = true;
    },
    commitTransaction: async () => {
      endTransaction();
    },
    rollbackTransaction: async () => {
      endTransaction();
    },
    get isTransactionActive() {
      return transactionActive;
    },
    query: async (sql) => {
      if (sql.includes('pg_advisory_xact_lock')) {
        assert.equal(transactionActive, true);
        const previous = shared.lockTail;
        let release;
        const current = new Promise((resolve) => {
          release = resolve;
        });
        shared.lockTail = previous.catch(() => undefined).then(() => current);
        await previous.catch(() => undefined);
        releaseLock = release;
        return [];
      }

      throw new Error(`Unexpected migration lock SQL: ${sql}`);
    },
    release: async () => {
      if (transactionActive) endTransaction();
    },
  };

  return {
    dataSource: {
      createQueryRunner: () => queryRunner,
    },
    queryRunner,
  };
}

class TestMigrationBootstrapService extends StaffPinMigrationBootstrapService {
  constructor(dataSource, shared, expectedQueryRunner, shouldFail = false) {
    super(dataSource);
    this.shared = shared;
    this.expectedQueryRunner = expectedQueryRunner;
    this.shouldFail = shouldFail;
  }

  async executeRegisteredMigrations(queryRunner) {
    assert.equal(queryRunner, this.expectedQueryRunner);
    assert.equal(queryRunner.isTransactionActive, true);
    this.shared.runCalls += 1;
    this.shared.activeRuns += 1;
    this.shared.maxConcurrentRuns = Math.max(
      this.shared.maxConcurrentRuns,
      this.shared.activeRuns,
    );

    await new Promise((resolve) => setTimeout(resolve, 20));

    this.shared.activeRuns -= 1;
    if (this.shouldFail) throw new Error('migration failed');
    return [{ name: 'UpgradeStaffPinAttemptsPerAttempt2026081400020' }];
  }
}

test('two cold-start instances serialize migrations with a transaction-scoped database lock', async () => {
  const shared = createSharedMigrationState();
  const firstData = createDataSource(shared);
  const secondData = createDataSource(shared);
  const first = new TestMigrationBootstrapService(
    firstData.dataSource,
    shared,
    firstData.queryRunner,
  );
  const second = new TestMigrationBootstrapService(
    secondData.dataSource,
    shared,
    secondData.queryRunner,
  );

  await Promise.all([
    first.onApplicationBootstrap(),
    second.onApplicationBootstrap(),
  ]);

  assert.equal(shared.runCalls, 2);
  assert.equal(shared.maxConcurrentRuns, 1);
  assert.equal(shared.activeRuns, 0);
});

test('migration rollback releases the transaction-scoped lock for the next instance', async () => {
  const shared = createSharedMigrationState();
  const failingData = createDataSource(shared);
  const nextData = createDataSource(shared);
  const failing = new TestMigrationBootstrapService(
    failingData.dataSource,
    shared,
    failingData.queryRunner,
    true,
  );
  const next = new TestMigrationBootstrapService(
    nextData.dataSource,
    shared,
    nextData.queryRunner,
  );

  await assert.rejects(
    () => failing.onApplicationBootstrap(),
    /migration failed/,
  );
  await next.onApplicationBootstrap();

  assert.equal(shared.runCalls, 2);
  assert.equal(shared.maxConcurrentRuns, 1);
  assert.equal(shared.activeRuns, 0);
});
