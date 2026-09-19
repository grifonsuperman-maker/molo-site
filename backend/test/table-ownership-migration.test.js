const assert = require('node:assert/strict');
const test = require('node:test');

const {
  AddTableWaiterOwnership2026091901000,
} = require('../dist/migrations/2026091901000-AddTableWaiterOwnership.js');

function captureQueries(activeTables = 0, inTransaction = true) {
  const queries = [];
  return {
    queries,
    runner: {
      isTransactionActive: inTransaction,
      async query(sql) {
        queries.push(sql);
        if (/SELECT COUNT\(\*\)::int AS count FROM "tables"/.test(sql)) {
          return [{ count: activeTables }];
        }
        return [];
      },
    },
  };
}

test('ownership release is enforced by PostgreSQL on every table write', async () => {
  const { queries, runner } = captureQueries();
  await new AddTableWaiterOwnership2026091901000().up(runner);
  const sql = queries.join('\n');
  assert.match(sql, /BEFORE INSERT OR UPDATE ON "tables"/);
  assert.match(sql, /IF NEW\."status" IN \('free', 'pending', 'reserved'\)/);
  assert.match(sql, /NEW\."assigned_waiter_id" := NULL/);
  assert.match(sql, /EXECUTE FUNCTION "clear_waiter_owner_on_table_release"\(\)/);
});

test('migration locks tables before checking for active visits and changing the schema', async () => {
  const { queries, runner } = captureQueries();
  await new AddTableWaiterOwnership2026091901000().up(runner);
  assert.match(queries[0], /LOCK TABLE "tables" IN ACCESS EXCLUSIVE MODE/);
  assert.match(queries[1], /SELECT COUNT\(\*\)::int AS count/);
  assert.match(queries[2], /ALTER TABLE "tables"/);
});

test('migration refuses already occupied tables while holding the table lock', async () => {
  const { queries, runner } = captureQueries(2);
  await assert.rejects(
    () => new AddTableWaiterOwnership2026091901000().up(runner),
    /звільніть усі зайняті столи/,
  );
  assert.equal(queries.length, 2);
  assert.match(queries[0], /LOCK TABLE "tables"/);
  assert.ok(!queries.some((sql) => /ALTER TABLE|CREATE TRIGGER/i.test(sql)));
});

test('migration refuses autocommit mode because table lock would be released early', async () => {
  const { queries, runner } = captureQueries(0, false);
  await assert.rejects(
    () => new AddTableWaiterOwnership2026091901000().up(runner),
    /в одній транзакції/,
  );
  assert.deepEqual(queries, []);
});

test('rollback drops the release trigger before the owner column without requiring unassignment', async () => {
  const { queries, runner } = captureQueries();
  await new AddTableWaiterOwnership2026091901000().down(runner);
  assert.equal(queries.length, 5);
  assert.match(queries[0], /DROP TRIGGER IF EXISTS/);
  assert.match(queries[1], /DROP FUNCTION IF EXISTS/);
  assert.match(queries.at(-1), /DROP COLUMN IF EXISTS "assigned_waiter_id"/);
  assert.equal(queries.some((sql) => /SELECT count\(/i.test(sql)), false);
});
