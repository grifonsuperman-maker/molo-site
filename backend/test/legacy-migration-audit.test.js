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

function columnRow(table, name, length) {
  return {
    table_name: table,
    column_name: name,
    data_type: 'character varying',
    is_nullable: 'YES',
    column_default: null,
    character_maximum_length: length,
  };
}

function guestBookingArtifacts() {
  return {
    columns: [
      columnRow('bookings', 'guest_device_id_hash', 64),
      columnRow('bookings', 'guest_phone_normalized', 32),
    ],
    indexes: [
      {
        table_name: 'bookings',
        index_name: 'IDX_bookings_guest_device_id_hash',
        definition:
          'CREATE INDEX IDX_bookings_guest_device_id_hash ON bookings (guest_device_id_hash)',
      },
      {
        table_name: 'bookings',
        index_name: 'UQ_bookings_active_guest_device_date',
        definition:
          "CREATE UNIQUE INDEX UQ_bookings_active_guest_device_date ON bookings (booking_date, guest_device_id_hash) WHERE guest_device_id_hash IS NOT NULL AND status IN ('pending', 'approved')",
      },
      {
        table_name: 'bookings',
        index_name: 'UQ_bookings_active_guest_phone_date',
        definition:
          "CREATE UNIQUE INDEX UQ_bookings_active_guest_phone_date ON bookings (booking_date, guest_phone_normalized) WHERE guest_phone_normalized IS NOT NULL AND status IN ('pending', 'approved')",
      },
    ],
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

test('legacy migration audit verifies expected column metadata and partial-index predicates', async () => {
  const { auditLegacyMigrationArtifacts } = await loadAudit();
  const snapshot = emptySnapshot();
  const artifacts = guestBookingArtifacts();
  snapshot.columns.push(...artifacts.columns);
  snapshot.indexes.push(...artifacts.indexes);

  let result = auditLegacyMigrationArtifacts(snapshot);
  let bookingMigration = result.migrations.find(
    (migration) => migration.name === 'AddGuestDeviceIdHash2026072000000',
  );
  assert.equal(bookingMigration.schemaArtifactsPresent, true);

  snapshot.columns[0].data_type = 'text';
  result = auditLegacyMigrationArtifacts(snapshot);
  bookingMigration = result.migrations.find(
    (migration) => migration.name === 'AddGuestDeviceIdHash2026072000000',
  );
  assert.equal(bookingMigration.schemaArtifactsPresent, false);
  assert.ok(
    bookingMigration.missingArtifacts.includes(
      'column:bookings.guest_device_id_hash',
    ),
  );
});

test('legacy migration audit rejects an opposite NOT IN predicate with the same index name and values', async () => {
  const { auditLegacyMigrationArtifacts } = await loadAudit();
  const snapshot = emptySnapshot();
  const artifacts = guestBookingArtifacts();
  snapshot.columns.push(...artifacts.columns);
  snapshot.indexes.push(...artifacts.indexes);
  snapshot.indexes[1].definition =
    "CREATE UNIQUE INDEX UQ_bookings_active_guest_device_date ON bookings (booking_date, guest_device_id_hash) WHERE guest_device_id_hash IS NOT NULL AND status NOT IN ('pending', 'approved')";

  const result = auditLegacyMigrationArtifacts(snapshot);
  const bookingMigration = result.migrations.find(
    (migration) => migration.name === 'AddGuestDeviceIdHash2026072000000',
  );
  assert.equal(bookingMigration.schemaArtifactsPresent, false);
  assert.ok(
    bookingMigration.missingArtifacts.includes(
      'index:bookings.UQ_bookings_active_guest_device_date',
    ),
  );
});

test('legacy migration audit accepts PostgreSQL ANY form for the active booking predicate', async () => {
  const { auditLegacyMigrationArtifacts } = await loadAudit();
  const snapshot = emptySnapshot();
  const artifacts = guestBookingArtifacts();
  snapshot.columns.push(...artifacts.columns);
  snapshot.indexes.push(...artifacts.indexes);
  snapshot.indexes[1].definition =
    "CREATE UNIQUE INDEX UQ_bookings_active_guest_device_date ON public.bookings USING btree (booking_date, guest_device_id_hash) WHERE ((guest_device_id_hash IS NOT NULL) AND ((status)::text = ANY ((ARRAY['pending'::character varying, 'approved'::character varying])::text[])))";

  const result = auditLegacyMigrationArtifacts(snapshot);
  const bookingMigration = result.migrations.find(
    (migration) => migration.name === 'AddGuestDeviceIdHash2026072000000',
  );
  assert.equal(bookingMigration.schemaArtifactsPresent, true);
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
