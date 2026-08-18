import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const col = (table, name, dataType, options = {}) => ({
  kind: 'column',
  table,
  name,
  dataType,
  nullable: options.nullable ?? true,
  length: options.length ?? null,
  defaultValue:
    Object.prototype.hasOwnProperty.call(options, 'defaultValue')
      ? options.defaultValue
      : null,
});

const idx = (table, name, columns, options = {}) => ({
  kind: 'index',
  table,
  name,
  columns,
  unique: options.unique ?? false,
  requiredNotNull: options.requiredNotNull ?? null,
  statusValues: options.statusValues ?? null,
});

const fk = (table, name, column, referencedTable, onDelete) => ({
  kind: 'foreignKey',
  table,
  name,
  column,
  referencedTable,
  referencedColumn: 'id',
  onDelete,
});

const statusCheck = (table, name, values) => ({
  kind: 'statusCheck',
  table,
  name,
  values,
});

const legacyMigrations = [
  {
    name: 'CreateAvailabilityBlocks1784844000000',
    artifacts: [
      { kind: 'table', name: 'availability_blocks' },
      col('availability_blocks', 'id', 'uuid', {
        nullable: false,
        defaultValue: 'uuid_generate_v4()',
      }),
      col('availability_blocks', 'table_id', 'uuid'),
      col('availability_blocks', 'zone_id', 'uuid'),
      col('availability_blocks', 'block_date', 'date', { nullable: false }),
      col('availability_blocks', 'start_time', 'time without time zone'),
      col('availability_blocks', 'end_time', 'time without time zone'),
      col('availability_blocks', 'reason', 'text', { nullable: false }),
      col('availability_blocks', 'created_at', 'timestamp without time zone', {
        nullable: false,
        defaultValue: 'now()',
      }),
      fk(
        'availability_blocks',
        'FK_availability_blocks_table',
        'table_id',
        'tables',
        'cascade',
      ),
      fk(
        'availability_blocks',
        'FK_availability_blocks_zone',
        'zone_id',
        'zones',
        'cascade',
      ),
      {
        kind: 'check',
        table: 'availability_blocks',
        name: 'CHK_availability_blocks_single_target',
        normalizedExpression:
          'table_id is not null and zone_id is null or table_id is null and zone_id is not null',
      },
      {
        kind: 'check',
        table: 'availability_blocks',
        name: 'CHK_availability_blocks_time_pair',
        normalizedExpression:
          'start_time is null and end_time is null or start_time is not null and end_time is not null and start_time < end_time',
      },
      idx('availability_blocks', 'IDX_availability_blocks_date', ['block_date']),
    ],
  },
  {
    name: 'CreateBookingTableChangeRequests1784930400000',
    artifacts: [
      { kind: 'table', name: 'booking_table_change_requests' },
      col('booking_table_change_requests', 'id', 'uuid', {
        nullable: false,
        defaultValue: 'uuid_generate_v4()',
      }),
      col('booking_table_change_requests', 'booking_id', 'uuid', {
        nullable: false,
      }),
      col(
        'booking_table_change_requests',
        'requested_table_number',
        'character varying',
        { length: 32 },
      ),
      col('booking_table_change_requests', 'approved_table_id', 'uuid'),
      col('booking_table_change_requests', 'status', 'character varying', {
        nullable: false,
        length: 20,
        defaultValue: "'pending'",
      }),
      col('booking_table_change_requests', 'admin_comment', 'text'),
      col(
        'booking_table_change_requests',
        'created_at',
        'timestamp without time zone',
        { nullable: false, defaultValue: 'now()' },
      ),
      col(
        'booking_table_change_requests',
        'resolved_at',
        'timestamp without time zone',
      ),
      fk(
        'booking_table_change_requests',
        'FK_booking_table_change_requests_booking',
        'booking_id',
        'bookings',
        'cascade',
      ),
      fk(
        'booking_table_change_requests',
        'FK_booking_table_change_requests_approved_table',
        'approved_table_id',
        'tables',
        'set null',
      ),
      statusCheck(
        'booking_table_change_requests',
        'CHK_booking_table_change_requests_status',
        ['pending', 'approved', 'rejected'],
      ),
      idx(
        'booking_table_change_requests',
        'IDX_booking_table_change_requests_created_at',
        ['created_at'],
      ),
      idx(
        'booking_table_change_requests',
        'UQ_booking_table_change_requests_pending_booking',
        ['booking_id'],
        { unique: true, statusValues: ['pending'] },
      ),
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
      ].map((name) =>
        col('restaurant', name, 'boolean', {
          nullable: false,
          defaultValue: 'false',
        }),
      ),
      col('clients', 'blacklist_reason', 'text'),
      col('clients', 'blacklisted_at', 'timestamp without time zone'),
      col('guest_reviews', 'response_text', 'text'),
      col('guest_reviews', 'responded_at', 'timestamp without time zone'),
      col('guest_reviews', 'responded_by_name', 'character varying', {
        length: 160,
      }),
      col('guest_reviews', 'responded_by_role', 'character varying', {
        length: 32,
      }),
    ],
  },
  {
    name: 'CreateSyrveIntegration1785362400000',
    artifacts: [
      { kind: 'extension', name: 'pgcrypto' },
      { kind: 'table', name: 'syrve_integrations' },
      col('syrve_integrations', 'id', 'uuid', {
        nullable: false,
        defaultValue: 'gen_random_uuid()',
      }),
      col('syrve_integrations', 'display_name', 'character varying', {
        nullable: false,
        length: 120,
        defaultValue: "'MOLO · Syrve'",
      }),
      col('syrve_integrations', 'api_base_url', 'text', {
        nullable: false,
        defaultValue: "'https://api-eu.syrve.live'",
      }),
      col('syrve_integrations', 'api_login_encrypted', 'text'),
      col('syrve_integrations', 'api_login_iv', 'character varying', {
        length: 64,
      }),
      col('syrve_integrations', 'api_login_auth_tag', 'character varying', {
        length: 64,
      }),
      col('syrve_integrations', 'api_login_masked', 'character varying', {
        length: 160,
      }),
      col('syrve_integrations', 'organization_id', 'character varying', {
        length: 160,
      }),
      col('syrve_integrations', 'organization_name', 'character varying', {
        length: 240,
      }),
      col('syrve_integrations', 'status', 'character varying', {
        nullable: false,
        length: 32,
        defaultValue: "'not_connected'",
      }),
      col('syrve_integrations', 'last_checked_at', 'timestamp without time zone'),
      col('syrve_integrations', 'connected_at', 'timestamp without time zone'),
      col('syrve_integrations', 'last_error', 'text'),
      col('syrve_integrations', 'created_at', 'timestamp without time zone', {
        nullable: false,
        defaultValue: 'now()',
      }),
      col('syrve_integrations', 'updated_at', 'timestamp without time zone', {
        nullable: false,
        defaultValue: 'now()',
      }),
      statusCheck('syrve_integrations', 'CHK_syrve_integration_status', [
        'not_connected',
        'connected',
        'error',
      ]),
    ],
  },
  {
    name: 'AddDirectorAccessCredentials1785456000000',
    artifacts: [
      col('staff', 'director_login_name', 'character varying', { length: 64 }),
      col('staff', 'director_password_hash', 'text'),
      col('staff', 'director_credentials_configured_at', 'timestamp without time zone'),
      col('staff', 'director_failed_login_attempts', 'integer', {
        nullable: false,
        defaultValue: '0',
      }),
      col('staff', 'director_locked_until', 'timestamp without time zone'),
      idx('staff', 'IDX_staff_director_login_name', ['director_login_name'], {
        unique: true,
        requiredNotNull: 'director_login_name',
      }),
    ],
  },
  {
    name: 'AddHookahCallAvailability1786057200000',
    artifacts: [
      col('restaurant', 'hookah_calls_available', 'boolean', {
        nullable: false,
        defaultValue: 'true',
      }),
      col(
        'restaurant',
        'hookah_calls_availability_changed_at',
        'timestamp without time zone',
      ),
      col('hookah_calls', 'eta_due_at', 'timestamp without time zone'),
      col('hookah_calls', 'waiter_name', 'character varying', { length: 160 }),
      idx('hookah_calls', 'UQ_hookah_calls_active_booking', ['booking_id'], {
        unique: true,
        statusValues: ['new', 'accepted'],
      }),
    ],
    manualDataReview:
      'Migration contains historical UPDATE statements for eta_due_at and duplicate active hookah calls. Schema metadata cannot prove whether those data changes were already applied.',
  },
  {
    name: 'AddGuestDeviceIdHash2026072000000',
    artifacts: [
      col('bookings', 'guest_device_id_hash', 'character varying', { length: 64 }),
      col('bookings', 'guest_phone_normalized', 'character varying', { length: 32 }),
      idx('bookings', 'IDX_bookings_guest_device_id_hash', [
        'guest_device_id_hash',
      ]),
      idx(
        'bookings',
        'UQ_bookings_active_guest_device_date',
        ['booking_date', 'guest_device_id_hash'],
        {
          unique: true,
          requiredNotNull: 'guest_device_id_hash',
          statusValues: ['pending', 'approved'],
        },
      ),
      idx(
        'bookings',
        'UQ_bookings_active_guest_phone_date',
        ['booking_date', 'guest_phone_normalized'],
        {
          unique: true,
          requiredNotNull: 'guest_phone_normalized',
          statusValues: ['pending', 'approved'],
        },
      ),
    ],
  },
  {
    name: 'AddTelegramStaffInvites2026081200011',
    artifacts: [
      col('staff', 'telegram_invite_token_hash', 'text'),
      col(
        'staff',
        'telegram_invite_expires_at',
        'timestamp without time zone',
      ),
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

function normalizeSql(value) {
  return String(value || '')
    .replace(/"/g, '')
    .replace(/public\./gi, '')
    .replace(/::character varying/gi, '')
    .replace(/::text\[\]/gi, '')
    .replace(/::text/gi, '')
    .replace(/::boolean/gi, '')
    .replace(/::integer/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function normalizeDefault(value) {
  if (value == null) return null;
  return normalizeSql(value).replace(/^\((.*)\)$/s, '$1').trim();
}

function columnMatches(row, artifact) {
  if (row.data_type !== artifact.dataType) return false;
  if (row.is_nullable !== (artifact.nullable ? 'YES' : 'NO')) return false;

  if (artifact.length == null) {
    if (row.character_maximum_length != null) return false;
  } else if (Number(row.character_maximum_length) !== artifact.length) {
    return false;
  }

  return normalizeDefault(row.column_default) === normalizeDefault(artifact.defaultValue);
}

function extractIndexColumns(definition) {
  const normalized = normalizeSql(definition);
  const match = normalized.match(/(?:using\s+btree\s*)?\(([^)]+)\)(?:\s+where\s+|$)/);
  if (!match) return [];
  return match[1].split(',').map((value) => value.trim());
}

function extractWhere(definition) {
  const normalized = normalizeSql(definition);
  const whereIndex = normalized.indexOf(' where ');
  return whereIndex === -1 ? null : normalized.slice(whereIndex + 7).trim();
}

function quotedValues(value) {
  return [...String(value || '').matchAll(/'([^']+)'/g)]
    .map((match) => match[1].toLowerCase())
    .sort();
}

function sameValues(actual, expected) {
  const sortedExpected = [...expected].map((value) => value.toLowerCase()).sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((value, index) => value === sortedExpected[index])
  );
}

function positiveStatusPredicate(where, expectedValues) {
  if (!where || /\bor\b/.test(where)) return false;
  if (/status\s+not\s+in\b/.test(where)) return false;
  if (/\bnot\s*\(*\s*status\b/.test(where)) return false;
  if (!/\bstatus\b/.test(where)) return false;
  if (!sameValues(quotedValues(where), expectedValues)) return false;

  if (expectedValues.length === 1) {
    return /\bstatus\b[^=]*=/.test(where) || /\bstatus\b.*\bin\b/.test(where);
  }

  return /\bstatus\b.*(?:\bin\b|=\s*any\b)/.test(where);
}

function indexMatches(row, artifact) {
  const normalized = normalizeSql(row.definition);
  const unique = /\bcreate\s+unique\s+index\b/.test(normalized);
  if (unique !== artifact.unique) return false;

  const columns = extractIndexColumns(row.definition);
  if (
    columns.length !== artifact.columns.length ||
    columns.some((column, index) => column !== artifact.columns[index])
  ) {
    return false;
  }

  const where = extractWhere(row.definition);
  const expectsPredicate = Boolean(
    artifact.requiredNotNull || artifact.statusValues,
  );
  if (Boolean(where) !== expectsPredicate) return false;

  if (artifact.requiredNotNull) {
    const nullPattern = new RegExp(
      `\\b${artifact.requiredNotNull}\\b\\s+is\\s+not\\s+null`,
    );
    if (!nullPattern.test(where)) return false;
  }

  if (artifact.statusValues) {
    if (!positiveStatusPredicate(where, artifact.statusValues)) return false;
  }

  if (artifact.requiredNotNull && artifact.statusValues && !/\band\b/.test(where)) {
    return false;
  }

  if (artifact.requiredNotNull && !artifact.statusValues) {
    const simplified = where
      .replace(/[()]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (simplified !== `${artifact.requiredNotNull} is not null`) return false;
  }

  return true;
}

function foreignKeyMatches(row, artifact) {
  const normalized = normalizeSql(row.definition);
  const match = normalized.match(
    /foreign key\s*\(([^)]+)\)\s+references\s+([a-z0-9_]+)\s*\(([^)]+)\)/,
  );
  if (!match) return false;

  return (
    match[1].trim() === artifact.column &&
    match[2].trim() === artifact.referencedTable &&
    match[3].trim() === artifact.referencedColumn &&
    normalized.includes(`on delete ${artifact.onDelete}`)
  );
}

function normalizedCheckExpression(definition) {
  return normalizeSql(definition)
    .replace(/^check\s*/, '')
    .replace(/[()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function statusCheckMatches(row, artifact) {
  const normalized = normalizeSql(row.definition);
  if (/status\s+not\s+in\b/.test(normalized)) return false;
  if (/\bnot\s*\(*\s*status\b/.test(normalized)) return false;
  if (/\bor\b/.test(normalized)) return false;
  if (!/\bstatus\b/.test(normalized)) return false;
  return sameValues(quotedValues(normalized), artifact.values);
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
        row.table_name === artifact.table &&
        row.column_name === artifact.name &&
        columnMatches(row, artifact),
    );
  }

  if (artifact.kind === 'foreignKey') {
    return snapshot.constraints.some(
      (row) =>
        row.table_name === artifact.table &&
        row.constraint_name === artifact.name &&
        foreignKeyMatches(row, artifact),
    );
  }

  if (artifact.kind === 'check') {
    return snapshot.constraints.some(
      (row) =>
        row.table_name === artifact.table &&
        row.constraint_name === artifact.name &&
        normalizedCheckExpression(row.definition) === artifact.normalizedExpression,
    );
  }

  if (artifact.kind === 'statusCheck') {
    return snapshot.constraints.some(
      (row) =>
        row.table_name === artifact.table &&
        row.constraint_name === artifact.name &&
        statusCheckMatches(row, artifact),
    );
  }

  if (artifact.kind === 'index') {
    return snapshot.indexes.some(
      (row) =>
        row.table_name === artifact.table &&
        row.index_name === artifact.name &&
        indexMatches(row, artifact),
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

  const migrations = legacyMigrations.map((migration) => {
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
