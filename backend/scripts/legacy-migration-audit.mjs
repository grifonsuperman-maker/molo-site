import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const LEGACY_MIGRATIONS = [
  {
    name: 'CreateAvailabilityBlocks1784844000000',
    artifacts: [
      { kind: 'table', name: 'availability_blocks' },
      ...[
        'id',
        'table_id',
        'zone_id',
        'block_date',
        'start_time',
        'end_time',
        'reason',
        'created_at',
      ].map((name) => ({ kind: 'column', table: 'availability_blocks', name })),
      {
        kind: 'constraint',
        table: 'availability_blocks',
        name: 'FK_availability_blocks_table',
        includes: ['FOREIGN KEY', 'table_id', 'tables'],
      },
      {
        kind: 'constraint',
        table: 'availability_blocks',
        name: 'FK_availability_blocks_zone',
        includes: ['FOREIGN KEY', 'zone_id', 'zones'],
      },
      {
        kind: 'constraint',
        table: 'availability_blocks',
        name: 'CHK_availability_blocks_single_target',
        includes: ['table_id', 'zone_id'],
      },
      {
        kind: 'constraint',
        table: 'availability_blocks',
        name: 'CHK_availability_blocks_time_pair',
        includes: ['start_time', 'end_time'],
      },
      {
        kind: 'index',
        table: 'availability_blocks',
        name: 'IDX_availability_blocks_date',
        includes: ['block_date'],
      },
    ],
  },
  {
    name: 'CreateBookingTableChangeRequests1784930400000',
    artifacts: [
      { kind: 'table', name: 'booking_table_change_requests' },
      ...[
        'id',
        'booking_id',
        'requested_table_number',
        'approved_table_id',
        'status',
        'admin_comment',
        'created_at',
        'resolved_at',
      ].map((name) => ({
        kind: 'column',
        table: 'booking_table_change_requests',
        name,
      })),
      {
        kind: 'constraint',
        table: 'booking_table_change_requests',
        name: 'FK_booking_table_change_requests_booking',
        includes: ['FOREIGN KEY', 'booking_id', 'bookings'],
      },
      {
        kind: 'constraint',
        table: 'booking_table_change_requests',
        name: 'FK_booking_table_change_requests_approved_table',
        includes: ['FOREIGN KEY', 'approved_table_id', 'tables'],
      },
      {
        kind: 'constraint',
        table: 'booking_table_change_requests',
        name: 'CHK_booking_table_change_requests_status',
        includes: ['pending', 'approved', 'rejected'],
      },
      {
        kind: 'index',
        table: 'booking_table_change_requests',
        name: 'IDX_booking_table_change_requests_created_at',
        includes: ['created_at'],
      },
      {
        kind: 'index',
        table: 'booking_table_change_requests',
        name: 'UQ_booking_table_change_requests_pending_booking',
        includes: ['UNIQUE', 'booking_id', 'pending'],
      },
    ],
  },
  {
    name: 'AddDirectorControlCenter1785276000000',
    artifacts: [
      ...[
        'admin_can_manage_blacklist',
        'admin_can_respond_reviews',
        'admin_can_manage_staff_shifts',
        'admin_can_send_broadcasts',
      ].map((name) => ({ kind: 'column', table: 'restaurant', name })),
      ...['blacklist_reason', 'blacklisted_at'].map((name) => ({
        kind: 'column',
        table: 'clients',
        name,
      })),
      ...[
        'response_text',
        'responded_at',
        'responded_by_name',
        'responded_by_role',
      ].map((name) => ({ kind: 'column', table: 'guest_reviews', name })),
    ],
  },
  {
    name: 'CreateSyrveIntegration1785362400000',
    artifacts: [
      { kind: 'extension', name: 'pgcrypto' },
      { kind: 'table', name: 'syrve_integrations' },
      ...[
        'id',
        'display_name',
        'api_base_url',
        'api_login_encrypted',
        'api_login_iv',
        'api_login_auth_tag',
        'api_login_masked',
        'organization_id',
        'organization_name',
        'status',
        'last_checked_at',
        'connected_at',
        'last_error',
        'created_at',
        'updated_at',
      ].map((name) => ({ kind: 'column', table: 'syrve_integrations', name })),
      {
        kind: 'constraint',
        table: 'syrve_integrations',
        name: 'CHK_syrve_integration_status',
        includes: ['not_connected', 'connected', 'error'],
      },
    ],
  },
  {
    name: 'AddDirectorAccessCredentials1785456000000',
    artifacts: [
      ...[
        'director_login_name',
        'director_password_hash',
        'director_credentials_configured_at',
        'director_failed_login_attempts',
        'director_locked_until',
      ].map((name) => ({ kind: 'column', table: 'staff', name })),
      {
        kind: 'index',
        table: 'staff',
        name: 'IDX_staff_director_login_name',
        includes: ['UNIQUE', 'director_login_name', 'IS NOT NULL'],
      },
    ],
  },
  {
    name: 'AddHookahCallAvailability1786057200000',
    artifacts: [
      ...[
        'hookah_calls_available',
        'hookah_calls_availability_changed_at',
      ].map((name) => ({ kind: 'column', table: 'restaurant', name })),
      ...['eta_due_at', 'waiter_name'].map((name) => ({
        kind: 'column',
        table: 'hookah_calls',
        name,
      })),
      {
        kind: 'index',
        table: 'hookah_calls',
        name: 'UQ_hookah_calls_active_booking',
        includes: ['UNIQUE', 'booking_id', 'new', 'accepted'],
      },
    ],
    manualDataReview:
      'Migration contains historical UPDATE statements for eta_due_at and duplicate active hookah calls. Schema metadata cannot prove whether those data changes were already applied.',
  },
  {
    name: 'AddGuestDeviceIdHash2026072000000',
    artifacts: [
      { kind: 'column', table: 'bookings', name: 'guest_device_id_hash' },
      { kind: 'column', table: 'bookings', name: 'guest_phone_normalized' },
      {
        kind: 'index',
        table: 'bookings',
        name: 'IDX_bookings_guest_device_id_hash',
        includes: ['guest_device_id_hash'],
      },
      {
        kind: 'index',
        table: 'bookings',
        name: 'UQ_bookings_active_guest_device_date',
        includes: ['UNIQUE', 'booking_date', 'guest_device_id_hash', 'pending', 'approved'],
      },
      {
        kind: 'index',
        table: 'bookings',
        name: 'UQ_bookings_active_guest_phone_date',
        includes: ['UNIQUE', 'booking_date', 'guest_phone_normalized', 'pending', 'approved'],
      },
    ],
  },
  {
    name: 'AddTelegramStaffInvites2026081200011',
    artifacts: [
      { kind: 'column', table: 'staff', name: 'telegram_invite_token_hash' },
      { kind: 'column', table: 'staff', name: 'telegram_invite_expires_at' },
    ],
  },
];

function assertSnapshotShape(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw new Error('Schema snapshot must be a JSON object');
  }

  for (const section of [
    'extensions',
    'tables',
    'columns',
    'constraints',
    'indexes',
    'typeOrmMigrations',
  ]) {
    if (!Array.isArray(snapshot[section])) {
      throw new Error(`Schema snapshot is missing the ${section} array`);
    }
  }
}

function includesAll(value, fragments = []) {
  const normalized = String(value || '').toLowerCase();
  return fragments.every((fragment) =>
    normalized.includes(String(fragment).toLowerCase()),
  );
}

function artifactPresent(snapshot, artifact) {
  if (artifact.kind === 'extension') {
    return snapshot.extensions.some((row) => row.name === artifact.name);
  }

  if (artifact.kind === 'table') {
    return snapshot.tables.some((row) => row.table_name === artifact.name);
  }

  if (artifact.kind === 'column') {
    return snapshot.columns.some(
      (row) =>
        row.table_name === artifact.table && row.column_name === artifact.name,
    );
  }

  if (artifact.kind === 'constraint') {
    return snapshot.constraints.some(
      (row) =>
        row.table_name === artifact.table &&
        row.constraint_name === artifact.name &&
        includesAll(row.definition, artifact.includes),
    );
  }

  if (artifact.kind === 'index') {
    return snapshot.indexes.some(
      (row) =>
        row.table_name === artifact.table &&
        row.index_name === artifact.name &&
        includesAll(row.definition, artifact.includes),
    );
  }

  throw new Error(`Unsupported artifact kind: ${artifact.kind}`);
}

function describeArtifact(artifact) {
  if (artifact.table) {
    return `${artifact.kind}:${artifact.table}.${artifact.name}`;
  }
  return `${artifact.kind}:${artifact.name}`;
}

export function auditLegacyMigrationArtifacts(snapshot) {
  assertSnapshotShape(snapshot);

  const recordedNames = new Set(
    snapshot.typeOrmMigrations.map((row) => row.name).filter(Boolean),
  );

  const migrations = LEGACY_MIGRATIONS.map((migration) => {
    const missingArtifacts = migration.artifacts
      .filter((artifact) => !artifactPresent(snapshot, artifact))
      .map(describeArtifact);

    return {
      name: migration.name,
      schemaArtifactsPresent: missingArtifacts.length === 0,
      alreadyRecordedByTypeOrm: recordedNames.has(migration.name),
      missingArtifacts,
      manualDataReview: migration.manualDataReview || null,
    };
  });

  return {
    schemaArtifactsComplete: migrations.every(
      (migration) => migration.schemaArtifactsPresent,
    ),
    legacyMigrationsAlreadyRecorded: migrations
      .filter((migration) => migration.alreadyRecordedByTypeOrm)
      .map((migration) => migration.name),
    manualDataReviewRequired: migrations
      .filter((migration) => migration.manualDataReview)
      .map((migration) => ({
        name: migration.name,
        reason: migration.manualDataReview,
      })),
    migrations,
  };
}

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    throw new Error(
      'Usage: node scripts/legacy-migration-audit.mjs <schema-audit-or-baseline.json>',
    );
  }

  const snapshot = JSON.parse(await readFile(inputPath, 'utf8'));
  const result = auditLegacyMigrationArtifacts(snapshot);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

  if (!result.schemaArtifactsComplete) {
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(
      `Legacy migration audit failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}
