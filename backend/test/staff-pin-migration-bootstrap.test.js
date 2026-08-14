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
    createQueryRunner: () => queryRunner,
    runMigrations: async (options) => {
      assert.deepEqual(options, { transaction: 'all' });
      shared.runCalls += 1;
      shared.activeRuns += 1;
      shared.maxConcurrentRuns = Math.max(
        shared.maxConcurrentRuns,
        shared.activeRuns,
      );

      await new Promise((resolve) => setTimeout(resolve, 20));

      shared.activeRuns -= 1;
      return [{ name: 'CreateStaffPinAttempts2026081400010' }];
    },
  };
}

test('two cold-start instances serialize registered migrations with one database lock', async () => {
  const shared = createSharedMigrationState();
  const first = new StaffPinMigrationBootstrapService(createDataSource(shared));
  const second = new StaffPinMigrationBootstrapService(createDataSource(shared));

  await Promise.all([
    first.onApplicationBootstrap(),
    second.onApplicationBootstrap(),
  ]);

  assert.equal(shared.runCalls, 2);
  assert.equal(shared.maxConcurrentRuns, 1);
  assert.equal(shared.activeRuns, 0);
});
