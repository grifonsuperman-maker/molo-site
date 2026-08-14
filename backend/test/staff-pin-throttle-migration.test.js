const assert = require('node:assert/strict');
const test = require('node:test');

const {
  CreateStaffPinAttempts2026081400010,
} = require('../dist/migrations/2026081400010-CreateStaffPinAttempts.js');
const {
  UpgradeStaffPinAttemptsPerAttempt2026081400020,
} = require('../dist/migrations/2026081400020-UpgradeStaffPinAttemptsPerAttempt.js');

function createQueryRunner() {
  const queries = [];
  return {
    queries,
    query: async (sql) => {
      queries.push(sql);
    },
  };
}

test('original staff PIN migration remains the aggregate schema', async () => {
  const migration = new CreateStaffPinAttempts2026081400010();
  const runner = createQueryRunner();

  await migration.up(runner);

  const sql = runner.queries.join('\n');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS "staff_pin_attempts"/);
  assert.match(sql, /"attempt_count" integer NOT NULL DEFAULT 0/);
  assert.match(sql, /PRIMARY KEY \("scope", "subject_hash"\)/);
  assert.match(sql, /IDX_staff_pin_attempts_updated_at/);
  assert.doesNotMatch(sql, /"id" bigserial/);
});

test('later migration recreates staff PIN state with the final per-attempt schema', async () => {
  const migration = new UpgradeStaffPinAttemptsPerAttempt2026081400020();
  const runner = createQueryRunner();

  await migration.up(runner);

  const sql = runner.queries.join('\n');
  assert.match(sql, /DROP TABLE IF EXISTS "staff_pin_attempts"/);
  assert.match(sql, /CREATE TABLE "staff_pin_attempts"/);
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
  assert.doesNotMatch(sql, /"attempt_count" integer/);
});

test('per-attempt migration down restores the aggregate schema expected by the prior migration', async () => {
  const migration = new UpgradeStaffPinAttemptsPerAttempt2026081400020();
  const runner = createQueryRunner();

  await migration.down(runner);

  const sql = runner.queries.join('\n');
  assert.match(sql, /DROP TABLE IF EXISTS "staff_pin_attempts"/);
  assert.match(sql, /"attempt_count" integer NOT NULL DEFAULT 0/);
  assert.match(sql, /PRIMARY KEY \("scope", "subject_hash"\)/);
  assert.match(sql, /IDX_staff_pin_attempts_updated_at/);
});
