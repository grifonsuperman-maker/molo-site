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

  const queryRunner = {
    connect: async () => {},
    query: async (sql) => {
      if (sql.includes('pg_advisory_lock')) {
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

      if (sql.includes('pg_advisory_unlock')) {
        if (releaseLock) {
          releaseLock();
          releaseLock = null;
        }
        return [{ pg_advisory_unlock: true }];
      }

      throw new Error(`Unexpected migration lock SQL: ${sql}`);
    },
    release: async () => {
      if (releaseLock) {
        releaseLock();
        releaseLock = null;
      }
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
  constructor(dataSource, shared, expectedQueryRunner) {
    super(dataSource);
    this.shared = shared;
    this.expectedQueryRunner = expectedQueryRunner;
  }

  async executeRegisteredMigrations(queryRunner) {
    assert.equal(queryRunner, this.expectedQueryRunner);
    this.shared.runCalls += 1;
    this.shared.activeRuns += 1;
    this.shared.maxConcurrentRuns = Math.max(
      this.shared.maxConcurrentRuns,
      this.shared.activeRuns,
    );

    await new Promise((resolve) => setTimeout(resolve, 20));

    this.shared.activeRuns -= 1;
    return [{ name: 'CreateStaffPinAttempts2026081400010' }];
  }
}

test('two cold-start instances serialize migrations on the same locked query runner', async () => {
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
