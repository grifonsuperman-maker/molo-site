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

test('staff PIN migration creates per-attempt persistent rows', async () => {
  const migration = new CreateStaffPinAttempts2026081400010();
  const runner = createQueryRunner();

  await migration.up(runner);

  const sql = runner.queries.join('\n');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS "staff_pin_attempts"/);
  assert.match(sql, /"id" bigserial NOT NULL/);
  assert.match(sql, /"status" varchar\(16\) NOT NULL DEFAULT 'pending'/);
  assert.match(sql, /"reserved_at" timestamptz NOT NULL DEFAULT NOW\(\)/);
  assert.match(sql, /"failed_at" timestamptz/);
  assert.match(sql, /"locked_until" timestamptz/);
  assert.match(sql, /PRIMARY KEY \("id"\)/);
  assert.match(sql, /CHECK \("status" IN \('pending', 'failed'\)\)/);
  assert.match(sql, /IDX_staff_pin_attempts_subject/);
  assert.match(sql, /IDX_staff_pin_attempts_reserved_at/);
  assert.match(sql, /IDX_staff_pin_attempts_failed_at/);
  assert.doesNotMatch(sql, /attempt_count/);
});

test('staff PIN migration down removes its indexes and table', async () => {
  const migration = new CreateStaffPinAttempts2026081400010();
  const runner = createQueryRunner();

  await migration.down(runner);

  const sql = runner.queries.join('\n');
  assert.match(sql, /DROP INDEX IF EXISTS "IDX_staff_pin_attempts_failed_at"/);
  assert.match(sql, /DROP INDEX IF EXISTS "IDX_staff_pin_attempts_reserved_at"/);
  assert.match(sql, /DROP INDEX IF EXISTS "IDX_staff_pin_attempts_subject"/);
  assert.match(sql, /DROP TABLE IF EXISTS "staff_pin_attempts"/);
});
