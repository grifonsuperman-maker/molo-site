const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { CreateGuestPushSubscriptions2026092000010 } = require('../dist/migrations/2026092000010-CreateGuestPushSubscriptions.js');

function mockRunner(rows = [], isTransactionActive = true) {
  const statements = [];
  return {
    statements,
    isTransactionActive,
    query: async (sql) => {
      statements.push(sql);
      return rows.shift() || [];
    },
  };
}

test('push migration creates only its own booking-scoped table', async () => {
  const runner = mockRunner();
  await new CreateGuestPushSubscriptions2026092000010().up(runner);
  assert.equal(runner.statements.length, 1);
  const sql = runner.statements[0];
  assert.match(sql, /CREATE TABLE "guest_push_subscriptions"/);
  assert.match(sql, /PRIMARY KEY \("booking_id", "endpoint_hash"\)/);
  assert.match(sql, /FOREIGN KEY \("booking_id"\) REFERENCES "bookings" \("id"\) ON DELETE CASCADE/);
  assert.match(sql, /"guest_device_id_hash" character varying\(64\) NOT NULL/);
  assert.doesNotMatch(sql, /"guest_access_token"|"guest_access_token_hash"|"guest_device_id"\s/);
  assert.doesNotMatch(sql, /ALTER TABLE|DROP TABLE|DELETE FROM|UPDATE "bookings"/i);
});

test('rollback locks the table before checking it is empty', async () => {
  const runner = mockRunner([[{ present: true }], [], [{ hasSubscriptions: false }]]);
  await new CreateGuestPushSubscriptions2026092000010().down(runner);
  assert.equal(runner.statements.length, 4);
  assert.equal(runner.statements[1], 'LOCK TABLE "guest_push_subscriptions" IN ACCESS EXCLUSIVE MODE');
  assert.match(runner.statements[2], /SELECT EXISTS \(SELECT 1 FROM "guest_push_subscriptions"\)/);
  assert.equal(runner.statements[3], 'DROP TABLE "guest_push_subscriptions"');
});

test('rollback refuses to erase registered guest devices while holding the lock', async () => {
  const runner = mockRunner([[{ present: true }], [], [{ hasSubscriptions: true }]]);
  await assert.rejects(
    new CreateGuestPushSubscriptions2026092000010().down(runner),
    /Cannot revert guest push subscriptions while subscription records exist/,
  );
  assert.equal(runner.statements.length, 3);
  assert.match(runner.statements[1], /LOCK TABLE/);
  assert.doesNotMatch(runner.statements.join('\n'), /DROP TABLE/);
});

test('rollback refuses to run outside a transaction', async () => {
  const runner = mockRunner([], false);
  await assert.rejects(
    new CreateGuestPushSubscriptions2026092000010().down(runner),
    /requires an active transaction/,
  );
  assert.equal(runner.statements.length, 0);
});

test('rollback safely skips an absent push table inside a transaction', async () => {
  const runner = mockRunner([[{ present: false }]]);
  await new CreateGuestPushSubscriptions2026092000010().down(runner);
  assert.equal(runner.statements.length, 1);
});

test('production startup cannot register the guest push migration', () => {
  const appModule = fs.readFileSync(path.resolve(__dirname, '../src/app.module.ts'), 'utf8');
  assert.match(appModule, /configService\.get<string>\('NODE_ENV'\) === 'test'/);
  assert.match(appModule, /configService\.get<string>\('FRESH_SCHEMA_REFERENCE_ALLOW'\) === 'true'/);
  assert.match(appModule, /dbName === 'molo_fresh_schema_reference'/);
  assert.match(appModule, /!dbUrl/);
  assert.match(appModule, /migrations: isDisposableSchemaReference/);
  assert.doesNotMatch(
    appModule.split('const staffPinMigrationOptions = {')[1].split('};')[0],
    /CreateGuestPushSubscriptions2026092000010/,
  );
});
