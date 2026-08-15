const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  AddWaiterCallAssignmentActive2026081500015,
} = require('../dist/migrations/2026081500015-AddWaiterCallAssignmentActive.js');
const {
  CloseInactiveWaiterCalls2026081500020,
} = require('../dist/migrations/2026081500020-CloseInactiveWaiterCalls.js');

test('waiter call schema upgrades stay in separate ordered migrations', async () => {
  const createMigrationSource = fs.readFileSync(
    path.join(__dirname, '../src/migrations/2026081500010-CreateWaiterCalls.ts'),
    'utf8',
  );
  const appModuleSource = fs.readFileSync(
    path.join(__dirname, '../src/app.module.ts'),
    'utf8',
  );

  assert.doesNotMatch(
    createMigrationSource,
    /assignment_active/,
    'the original waiter_calls migration must not be retroactively changed',
  );
  assert.match(
    createMigrationSource,
    /IDX_waiter_calls_waiter_status/,
    'the original waiter_calls index must stay unchanged',
  );

  const createIndex = appModuleSource.indexOf('CreateWaiterCalls2026081500010,');
  const assignmentIndex = appModuleSource.indexOf(
    'AddWaiterCallAssignmentActive2026081500015,',
  );
  const lifecycleIndex = appModuleSource.indexOf(
    'CloseInactiveWaiterCalls2026081500020,',
  );
  assert.ok(createIndex >= 0);
  assert.ok(assignmentIndex > createIndex);
  assert.ok(lifecycleIndex > assignmentIndex);

  const assignmentUpQueries = [];
  const assignmentMigration = new AddWaiterCallAssignmentActive2026081500015();
  await assignmentMigration.up({
    query: async (sql) => assignmentUpQueries.push(sql),
  });
  const assignmentUpSql = assignmentUpQueries.join('\n');
  assert.match(
    assignmentUpSql,
    /ADD COLUMN IF NOT EXISTS "assignment_active" boolean NOT NULL DEFAULT true/,
  );
  assert.match(assignmentUpSql, /DROP INDEX IF EXISTS "IDX_waiter_calls_waiter_status"/);
  assert.match(
    assignmentUpSql,
    /CREATE INDEX IF NOT EXISTS "IDX_waiter_calls_waiter_assignment"/,
  );

  const assignmentDownQueries = [];
  await assignmentMigration.down({
    query: async (sql) => assignmentDownQueries.push(sql),
  });
  const assignmentDownSql = assignmentDownQueries.join('\n');
  assert.match(assignmentDownSql, /DROP COLUMN IF EXISTS "assignment_active"/);
  assert.match(
    assignmentDownSql,
    /CREATE INDEX IF NOT EXISTS "IDX_waiter_calls_waiter_status"/,
  );
});

test('terminal booking statuses close persisted waiter calls after assignment schema upgrade', async () => {
  const upQueries = [];
  const migration = new CloseInactiveWaiterCalls2026081500020();
  await migration.up({ query: async (sql) => upQueries.push(sql) });

  const upSql = upQueries.join('\n');
  assert.match(
    upSql,
    /CREATE OR REPLACE FUNCTION "close_waiter_calls_when_booking_inactive"\(\)/,
  );
  assert.match(
    upSql,
    /CREATE TRIGGER "TRG_bookings_close_waiter_calls_when_inactive"/,
  );
  assert.match(
    upSql,
    /NEW\."status" IN \('rejected', 'cancelled', 'completed'\)/,
  );
  assert.match(
    upSql,
    /WHEN "status" IN \('new', 'accepted'\) THEN 'closed'/,
  );
  assert.match(
    upSql,
    /FROM "bookings" AS booking/,
    'the follow-up migration must clean stale rows left by an earlier deployment',
  );
  assert.match(
    upSql,
    /booking\."status" IN \('rejected', 'cancelled', 'completed'\)/,
  );
  assert.match(upSql, /"assignment_active" = false/);

  const triggerQueryIndex = upQueries.findIndex((sql) =>
    sql.includes('CREATE TRIGGER "TRG_bookings_close_waiter_calls_when_inactive"'),
  );
  const cleanupQueryIndex = upQueries.findIndex((sql) =>
    sql.includes('UPDATE "waiter_calls" AS waiter_call'),
  );
  assert.ok(triggerQueryIndex >= 0 && cleanupQueryIndex > triggerQueryIndex);

  const downQueries = [];
  await migration.down({ query: async (sql) => downQueries.push(sql) });
  const downSql = downQueries.join('\n');
  assert.match(
    downSql,
    /DROP TRIGGER IF EXISTS "TRG_bookings_close_waiter_calls_when_inactive"/,
  );
  assert.match(
    downSql,
    /DROP FUNCTION IF EXISTS "close_waiter_calls_when_booking_inactive"\(\)/,
  );
});
