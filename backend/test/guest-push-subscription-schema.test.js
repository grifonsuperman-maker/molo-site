const assert = require('node:assert/strict');
const test = require('node:test');
const { CreateGuestPushSubscriptions2026092000010 } = require('../dist/migrations/2026092000010-CreateGuestPushSubscriptions.js');

function mockRunner(rows = []) {
  const statements = [];
  return {
    statements,
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

test('rollback drops only an existing empty push table', async () => {
  const runner = mockRunner([[{ present: true }], [{ hasSubscriptions: false }]]);
  await new CreateGuestPushSubscriptions2026092000010().down(runner);
  assert.equal(runner.statements.length, 3);
  assert.equal(runner.statements.at(-1), 'DROP TABLE "guest_push_subscriptions"');
});

test('rollback refuses to erase registered guest devices', async () => {
  const runner = mockRunner([[{ present: true }], [{ hasSubscriptions: true }]]);
  await assert.rejects(
    new CreateGuestPushSubscriptions2026092000010().down(runner),
    /Cannot revert guest push subscriptions while subscription records exist/,
  );
  assert.equal(runner.statements.length, 2);
});

test('rollback safely skips an absent push table', async () => {
  const runner = mockRunner([[{ present: false }]]);
  await new CreateGuestPushSubscriptions2026092000010().down(runner);
  assert.equal(runner.statements.length, 1);
});
