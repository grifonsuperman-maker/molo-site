const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  CloseInactiveWaiterCalls2026081500020,
} = require('../dist/migrations/2026081500020-CloseInactiveWaiterCalls.js');

test('waiter call lifecycle uses a separate registered migration after table creation', async () => {
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
    /close_waiter_calls_when_booking_inactive/,
    'the already-executed waiter_calls table migration must stay immutable',
  );
  assert.match(
    appModuleSource,
    /CloseInactiveWaiterCalls2026081500020/,
    'the follow-up migration must be registered in the existing migration bootstrap',
  );

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
    'the migration must clean up stale calls left by deployments that ran the prior migration',
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
