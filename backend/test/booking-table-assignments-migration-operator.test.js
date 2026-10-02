const assert = require('node:assert/strict');
const test = require('node:test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

const loader = import(pathToFileURL(path.resolve(__dirname, '../scripts/booking-table-assignments-migration-operator.mjs')).href);
const HOST = 'ep-banquet-test.eu-central-1.aws.neon.tech';
const DATABASE = 'molo';
const SHA = 'a'.repeat(40);
const validEnv = () => ({
  DB_URL: `postgresql://example:private@${HOST}/${DATABASE}?sslmode=require`,
  DB_SYNCHRONIZE: 'false',
  MOLO_BANQUET_BRANCH: 'test-banquet-migration',
  MOLO_BANQUET_EXPECTED_HOST: HOST,
  MOLO_BANQUET_EXPECTED_DATABASE: DATABASE,
  MOLO_BANQUET_REVIEWED_COMMIT: SHA,
});
const rows = (names, start = 10) => names.map((name, index) => ({
  id: start + index * 2,
  name,
  timestamp: name.match(/\d{13}$/)[0],
}));

test('target guard binds branch, host, database, TLS and synchronize=false', async () => {
  const { assertBanquetOperatorIntent } = await loader;
  const result = assertBanquetOperatorIntent('--check', validEnv());
  assert.equal(result.branch, 'test-banquet-migration');
  assert.equal(result.database, DATABASE);
  assert.ok(!result.url.includes('sslmode'));
  for (const patch of [
    { MOLO_BANQUET_BRANCH: '' },
    { MOLO_BANQUET_EXPECTED_HOST: 'another.neon.tech' },
    { MOLO_BANQUET_EXPECTED_DATABASE: 'other' },
    { DB_SYNCHRONIZE: 'true' },
    { DB_SYNCHRONIZE: undefined },
    { DB_URL: validEnv().DB_URL.replace('sslmode=require', 'sslmode=disable') },
    { DB_URL: validEnv().DB_URL + '&options=unsafe' },
  ]) {
    assert.throws(() => assertBanquetOperatorIntent('--check', { ...validEnv(), ...patch }));
  }
  assert.throws(() => assertBanquetOperatorIntent('--wrong', validEnv()), /--check/);
});

test('test apply requires the exact branch approval phrase', async () => {
  const { assertBanquetOperatorIntent } = await loader;
  assert.throws(() => assertBanquetOperatorIntent('--apply', validEnv()), /approval phrase/);
  const env = { ...validEnv(), MOLO_BANQUET_APPROVAL: 'apply-booking-table-assignments-to-test-banquet-migration' };
  assert.equal(assertBanquetOperatorIntent('--apply', env).branch, 'test-banquet-migration');
});

test('production apply requires backup, rehearsal, approval and a fresh verification time', async () => {
  const { assertBanquetOperatorIntent } = await loader;
  const now = Date.parse('2026-10-02T09:00:00Z');
  const env = {
    ...validEnv(),
    MOLO_BANQUET_BRANCH: 'production',
    MOLO_BANQUET_APPROVAL: 'apply-booking-table-assignments-to-production',
    MOLO_BANQUET_BACKUP_CONFIRMED: 'yes',
    MOLO_BANQUET_REHEARSAL_CONFIRMED: 'yes',
    MOLO_BANQUET_PRODUCTION_CHANGE_APPROVED: 'yes',
    MOLO_BANQUET_BACKUP_VERIFIED_AT: '2026-10-02T08:30:00Z',
  };
  assert.doesNotThrow(() => assertBanquetOperatorIntent('--apply', env, now));
  assert.throws(() => assertBanquetOperatorIntent('--apply', {
    ...env, MOLO_BANQUET_REHEARSAL_CONFIRMED: 'no',
  }, now), /rehearsal/);
  assert.throws(() => assertBanquetOperatorIntent('--apply', {
    ...env, MOLO_BANQUET_BACKUP_VERIFIED_AT: '2026-10-02T07:00:00Z',
  }, now), /within one hour/);
});

test('reviewed checkout must match the exact SHA and be clean', async () => {
  const { assertReviewedBanquetCheckout } = await loader;
  assert.equal(assertReviewedBanquetCheckout(validEnv(), SHA, ''), SHA);
  assert.throws(() => assertReviewedBanquetCheckout(validEnv(), 'b'.repeat(40), ''), /exact reviewed/);
  assert.throws(() => assertReviewedBanquetCheckout(validEnv(), SHA, ' M file'), /uncommitted/);
});

test('compiled artifacts must be bound to the same reviewed commit', async () => {
  const { assertReviewedBanquetBuild } = await loader;
  const build = {
    sourceCommit: SHA,
    sourceTree: 'b'.repeat(40),
    artifactFingerprint: 'c'.repeat(64),
  };
  assert.equal(assertReviewedBanquetBuild(validEnv(), build), build);
  assert.throws(() => assertReviewedBanquetBuild(validEnv(), {
    ...build, sourceCommit: 'd'.repeat(40),
  }), /Compiled backend artifacts/);
  assert.throws(() => assertReviewedBanquetBuild(validEnv(), {
    ...build, artifactFingerprint: 'bad',
  }), /Compiled backend artifacts/);
});

test('history accepts only reviewed post-Syrve baselines and the banquet row as the next migration', async () => {
  const { ACCEPTED_PRE_BANQUET_HISTORIES, BANQUET_MIGRATION, assertBanquetMigrationHistory } = await loader;
  for (const names of ACCEPTED_PRE_BANQUET_HISTORIES) {
    const before = rows(names);
    assert.deepEqual(assertBanquetMigrationHistory(before), names);
    assert.deepEqual(assertBanquetMigrationHistory([
      ...before,
      ...rows([BANQUET_MIGRATION], before.at(-1).id + 2),
    ], true), names);
  }
  const invalid = rows(ACCEPTED_PRE_BANQUET_HISTORIES[0]);
  invalid.at(-1).timestamp = '1';
  assert.throws(() => assertBanquetMigrationHistory(invalid), /IDs or timestamps/);
  assert.throws(() => assertBanquetMigrationHistory(rows([
    ...ACCEPTED_PRE_BANQUET_HISTORIES[0],
    'Unknown2026100200999',
  ])), /baseline/);
});

test('schema guard requires the exact pre-state and verified legacy backfill post-state', async () => {
  const { assertBookingTableAssignmentsSchema } = await loader;
  const base = {
    schemaName: 'public', assignmentTable: false, uuidGenerator: true,
    bookingUuid: true, bookingTableUuid: true, tableUuid: true,
  };
  await assertBookingTableAssignmentsSchema({ query: async () => [base] }, false);
  await assert.rejects(
    assertBookingTableAssignmentsSchema({ query: async () => [{ ...base, assignmentTable: true }] }, false),
    /expected banquet migration state/,
  );

  const responses = [
    [{ ...base, assignmentTable: true }],
    [{
      exactColumns: true, columnShape: true, primaryKey: true, bookingForeignKey: true, tableForeignKey: true,
      pairIndex: true, primaryIndex: true, tableIndex: true,
    }],
    [{ legacyBookings: 7, assignments: 7, primaryCoverage: true, noSecondaryAssignments: true }],
  ];
  const verified = { query: async () => responses.shift() };
  await assertBookingTableAssignmentsSchema(verified, true);

  const badData = [
    [{ ...base, assignmentTable: true }],
    [{
      exactColumns: true, columnShape: true, primaryKey: true, bookingForeignKey: true, tableForeignKey: true,
      pairIndex: true, primaryIndex: true, tableIndex: true,
    }],
    [{ legacyBookings: 7, assignments: 8, primaryCoverage: true, noSecondaryAssignments: false }],
  ];
  await assert.rejects(
    assertBookingTableAssignmentsSchema({ query: async () => badData.shift() }, true),
    /backfill/,
  );
});
