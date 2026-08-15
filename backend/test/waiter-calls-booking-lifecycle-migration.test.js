const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('terminal booking statuses close persisted waiter calls in the same database transaction', () => {
  const migrationSource = fs.readFileSync(
    path.join(__dirname, '../src/migrations/2026081500010-CreateWaiterCalls.ts'),
    'utf8',
  );

  assert.match(
    migrationSource,
    /CREATE OR REPLACE FUNCTION "close_waiter_calls_when_booking_inactive"\(\)/,
  );
  assert.match(
    migrationSource,
    /CREATE TRIGGER "TRG_bookings_close_waiter_calls_when_inactive"/,
  );
  assert.match(
    migrationSource,
    /NEW\."status" IN \('rejected', 'cancelled', 'completed'\)/,
  );
  assert.match(
    migrationSource,
    /WHEN "status" IN \('new', 'accepted'\) THEN 'closed'/,
  );
  assert.match(migrationSource, /"assignment_active" = false/);
  assert.match(
    migrationSource,
    /DROP TRIGGER IF EXISTS "TRG_bookings_close_waiter_calls_when_inactive"/,
  );
  assert.match(
    migrationSource,
    /DROP FUNCTION IF EXISTS "close_waiter_calls_when_booking_inactive"\(\)/,
  );
});
