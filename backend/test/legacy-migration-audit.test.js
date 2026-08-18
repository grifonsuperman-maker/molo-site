const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

async function loadAudit() {
  const modulePath = path.resolve(
    __dirname,
    '../scripts/legacy-migration-audit.mjs',
  );
  return import(pathToFileURL(modulePath).href);
}

function emptySnapshot() {
  return {
    extensions: [],
    tables: [],
    columns: [],
    constraints: [],
    indexes: [],
    typeOrmMigrations: [],
  };
}

test('legacy migration audit is offline and does not open a database connection', async () => {
  const source = await readFile(
    path.resolve(__dirname, '../scripts/legacy-migration-audit.mjs'),
    'utf8',
  );

  assert.doesNotMatch(source, /from ['"]pg['"]/);
  assert.doesNotMatch(source, /DB_URL|DB_HOST|DB_PASSWORD/);
  assert.doesNotMatch(source, /\.query\s*\(/);
});

test('legacy migration audit reports all eight unverified migrations on an empty snapshot', async () => {
  const { auditLegacyMigrationArtifacts } = await loadAudit();
  const result = auditLegacyMigrationArtifacts(emptySnapshot());

  assert.equal(result.schemaArtifactsComplete, false);
  assert.equal(result.migrations.length, 8);
  assert.equal(result.legacyMigrationsAlreadyRecorded.length, 0);
  assert.equal(result.manualDataReviewRequired.length, 1);
  assert.equal(
    result.manualDataReviewRequired[0].name,
    'AddHookahCallAvailability1786057200000',
  );
  assert.match(result.manualDataReviewRequired[0].reason, /historical UPDATE/);
});

test('legacy migration audit checks artifact definitions instead of names only', async () => {
  const { auditLegacyMigrationArtifacts } = await loadAudit();
  const snapshot = emptySnapshot();

  snapshot.columns.push(
    {
      table_name: 'bookings',
      column_name: 'guest_device_id_hash',
    },
    {
      table_name: 'bookings',
      column_name: 'guest_phone_normalized',
    },
  );
  snapshot.indexes.push(
    {
      table_name: 'bookings',
      index_name: 'IDX_bookings_guest_device_id_hash',
      definition: 'CREATE INDEX IDX_bookings_guest_device_id_hash ON bookings (guest_device_id_hash)',
    },
    {
      table_name: 'bookings',
      index_name: 'UQ_bookings_active_guest_device_date',
      definition:
        "CREATE UNIQUE INDEX UQ_bookings_active_guest_device_date ON bookings (booking_date, guest_device_id_hash) WHERE status IN ('pending', 'approved')",
    },
    {
      table_name: 'bookings',
      index_name: 'UQ_bookings_active_guest_phone_date',
      definition:
        "CREATE UNIQUE INDEX UQ_bookings_active_guest_phone_date ON bookings (booking_date, guest_phone_normalized) WHERE status IN ('pending', 'approved')",
    },
  );

  let result = auditLegacyMigrationArtifacts(snapshot);
  let bookingMigration = result.migrations.find(
    (migration) => migration.name === 'AddGuestDeviceIdHash2026072000000',
  );
  assert.equal(bookingMigration.schemaArtifactsPresent, true);

  snapshot.indexes[2].definition =
    'CREATE UNIQUE INDEX UQ_bookings_active_guest_phone_date ON bookings (booking_date, guest_phone_normalized)';

  result = auditLegacyMigrationArtifacts(snapshot);
  bookingMigration = result.migrations.find(
    (migration) => migration.name === 'AddGuestDeviceIdHash2026072000000',
  );
  assert.equal(bookingMigration.schemaArtifactsPresent, false);
  assert.ok(
    bookingMigration.missingArtifacts.includes(
      'index:bookings.UQ_bookings_active_guest_phone_date',
    ),
  );
});

test('legacy migration audit flags old migrations already present in TypeORM history', async () => {
  const { auditLegacyMigrationArtifacts } = await loadAudit();
  const snapshot = emptySnapshot();
  snapshot.typeOrmMigrations.push({
    id: 1,
    timestamp: '1784844000000',
    name: 'CreateAvailabilityBlocks1784844000000',
  });

  const result = auditLegacyMigrationArtifacts(snapshot);
  assert.deepEqual(result.legacyMigrationsAlreadyRecorded, [
    'CreateAvailabilityBlocks1784844000000',
  ]);
});

test('legacy migration audit rejects incomplete schema snapshots', async () => {
  const { auditLegacyMigrationArtifacts } = await loadAudit();

  assert.throws(
    () => auditLegacyMigrationArtifacts({}),
    /Schema snapshot is missing the extensions array/,
  );
});
