const assert = require('node:assert/strict');
const test = require('node:test');

const {
  CreateStaffPinAttempts2026081400010,
} = require('../dist/migrations/2026081400010-CreateStaffPinAttempts.js');

function createQueryRunner() {
  const queries = [];
  return {
    queries,
    query: async (sql) => {
      queries.push(sql);
    },
  };
}

test('staff PIN migration creates the persistent attempt table used by the service', async () => {
  const migration = new CreateStaffPinAttempts2026081400010();
  const runner = createQueryRunner();

  await migration.up(runner);

  const sql = runner.queries.join('\n');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS "staff_pin_attempts"/);
  assert.match(sql, /"attempt_count" integer NOT NULL DEFAULT 0/);
  assert.match(sql, /PRIMARY KEY \("scope", "subject_hash"\)/);
  assert.match(sql, /CHECK \("attempt_count" >= 0\)/);
  assert.match(sql, /IDX_staff_pin_attempts_updated_at/);
  assert.doesNotMatch(sql, /failed_attempts/);
});

test('staff PIN migration down removes its index and table', async () => {
  const migration = new CreateStaffPinAttempts2026081400010();
  const runner = createQueryRunner();

  await migration.down(runner);

  const sql = runner.queries.join('\n');
  assert.match(sql, /DROP INDEX IF EXISTS "IDX_staff_pin_attempts_updated_at"/);
  assert.match(sql, /DROP TABLE IF EXISTS "staff_pin_attempts"/);
});
