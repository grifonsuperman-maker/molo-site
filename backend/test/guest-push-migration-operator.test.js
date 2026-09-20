const assert = require('node:assert/strict');
const test = require('node:test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

const loader = import(pathToFileURL(path.resolve(__dirname, '../scripts/guest-push-migration-operator.mjs')).href);
const HOST = 'ep-example.eu-central-1.aws.neon.tech';
const validEnv = () => ({
  DB_URL: `postgresql://example:private@${HOST}/neondb?sslmode=require`,
  MOLO_PUSH_BRANCH: 'test-push-migration',
  MOLO_PUSH_EXPECTED_HOST: HOST,
  DB_SYNCHRONIZE: 'false',
});

test('check requires the explicit Neon host and branch, without approval for writes', async () => {
  const { assertOperatorIntent } = await loader;
  const result = assertOperatorIntent('--check', validEnv());
  assert.equal(result.branch, 'test-push-migration');
  assert.throws(() => assertOperatorIntent('--check', { ...validEnv(), MOLO_PUSH_EXPECTED_HOST: 'another.neon.tech' }), /does not match/);
  assert.throws(() => assertOperatorIntent('--check', { ...validEnv(), MOLO_PUSH_BRANCH: '' }), /branch name/);
  assert.throws(() => assertOperatorIntent('--check', { ...validEnv(), DB_SYNCHRONIZE: 'true' }), /refuses/);
  assert.throws(() => assertOperatorIntent('--check', { ...validEnv(), DB_URL: validEnv().DB_URL.replace('sslmode=require', 'sslmode=disable') }), /require SSL/);
  assert.throws(() => assertOperatorIntent('--wrong', validEnv()), /--check/);
});

test('apply to a test branch requires an exact separate approval phrase', async () => {
  const { assertOperatorIntent } = await loader;
  assert.throws(() => assertOperatorIntent('--apply', validEnv()), /approval phrase/);
  assert.equal(
    assertOperatorIntent('--apply', {
      ...validEnv(),
      MOLO_PUSH_APPROVAL: 'apply-guest-push-subscriptions-to-test-push-migration',
    }).branch,
    'test-push-migration',
  );
});

test('production apply requires a fresh backup assertion and separate approval', async () => {
  const { assertOperatorIntent } = await loader;
  const env = {
    ...validEnv(),
    MOLO_PUSH_BRANCH: 'production',
    MOLO_PUSH_APPROVAL: 'apply-guest-push-subscriptions-to-production',
  };
  assert.throws(() => assertOperatorIntent('--apply', env), /fresh verified backup/);
  assert.throws(() => assertOperatorIntent('--apply', { ...env, MOLO_PUSH_BACKUP_CONFIRMED: 'yes' }), /separate change approval/);
  assert.equal(
    assertOperatorIntent('--apply', {
      ...env,
      MOLO_PUSH_BACKUP_CONFIRMED: 'yes',
      MOLO_PUSH_PRODUCTION_CHANGE_APPROVED: 'yes',
    }).branch,
    'production',
  );
});

test('migration history must match the eight audited rows in order and timestamps', async () => {
  const { assertMigrationHistory, EXISTING_HISTORY, PUSH_MIGRATION } = await loader;
  const rows = EXISTING_HISTORY.map((name, index) => ({
    id: index + 1, name, timestamp: name.match(/\d{13}$/)[0],
  }));
  assert.doesNotThrow(() => assertMigrationHistory(rows));
  assert.throws(() => assertMigrationHistory(rows.slice(0, 7)), /history differs/);
  assert.throws(() => assertMigrationHistory([...rows.slice(0, 7), { ...rows[7], timestamp: '123' }]), /history differs/);
  assert.throws(() => assertMigrationHistory([...rows].reverse()), /history differs/);
  assert.throws(() => assertMigrationHistory([...rows, { id: 9, name: PUSH_MIGRATION, timestamp: '2026092000010' }]), /history differs/);
  assert.doesNotThrow(() => assertMigrationHistory([...rows, {
    id: 9, name: PUSH_MIGRATION, timestamp: '2026092000010',
  }], true));
});

test('schema guard demands bookings UUID and absent table before, booking FK after', async () => {
  const { assertSchema } = await loader;
  const fake = (state) => ({ query: async () => [state] });
  await assertSchema(fake({ schemaName: 'public', bookingUuid: true, pushTable: false, bookingLink: false }));
  await assert.rejects(assertSchema(fake({ schemaName: 'public', bookingUuid: true, pushTable: true, bookingLink: true })), /schema/);
  await assert.rejects(assertSchema(fake({ schemaName: 'public', bookingUuid: false, pushTable: false, bookingLink: false })), /schema/);
  await assert.rejects(assertSchema(fake({ schemaName: 'public', bookingUuid: true, pushTable: true, bookingLink: false }), true), /schema/);
  await assertSchema(fake({ schemaName: 'public', bookingUuid: true, pushTable: true, bookingLink: true }), true);
});
