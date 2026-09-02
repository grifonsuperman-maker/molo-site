import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

import { assertFreshSchemaReferenceTarget } from './fresh-schema-reference.mjs';
import { EXPECTED_RUNTIME_MIGRATIONS } from './runtime-migration-roundtrip.mjs';

export const INITIAL_BASELINE_MIGRATION = 'InitialSchemaBaseline2026081300000';
export const EXPECTED_FRESH_BASELINE_HISTORY = [
  INITIAL_BASELINE_MIGRATION,
  ...EXPECTED_RUNTIME_MIGRATIONS,
];

function assertMigrationNames(actualNames, expectedNames, label) {
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
    throw new Error(
      `Unexpected ${label}. Expected ${JSON.stringify(expectedNames)}, received ${JSON.stringify(actualNames)}`,
    );
  }
}

function loadMigrations(require) {
  const {
    InitialSchemaBaseline2026081300000,
  } = require('../dist/migrations/2026081300000-InitialSchemaBaseline.js');
  const {
    CreateStaffPinAttempts2026081400010,
  } = require('../dist/migrations/2026081400010-CreateStaffPinAttempts.js');
  const {
    UpgradeStaffPinAttemptsPerAttempt2026081400020,
  } = require('../dist/migrations/2026081400020-UpgradeStaffPinAttemptsPerAttempt.js');
  const {
    CreateWaiterCalls2026081500010,
  } = require('../dist/migrations/2026081500010-CreateWaiterCalls.js');
  const {
    AddWaiterCallAssignmentActive2026081500015,
  } = require('../dist/migrations/2026081500015-AddWaiterCallAssignmentActive.js');
  const {
    CloseInactiveWaiterCalls2026081500020,
  } = require('../dist/migrations/2026081500020-CloseInactiveWaiterCalls.js');
  const {
    AddGuestReviewArchive2026082200010,
  } = require('../dist/migrations/2026082200010-AddGuestReviewArchive.js');
  const {
    AddLogArchive2026082400010,
  } = require('../dist/migrations/2026082400010-AddLogArchive.js');
  const {
    AddManualBookingGuestName2026082400020,
  } = require('../dist/migrations/2026082400020-AddManualBookingGuestName.js');

  return [
    InitialSchemaBaseline2026081300000,
    CreateStaffPinAttempts2026081400010,
    UpgradeStaffPinAttemptsPerAttempt2026081400020,
    CreateWaiterCalls2026081500010,
    AddWaiterCallAssignmentActive2026081500015,
    CloseInactiveWaiterCalls2026081500020,
    AddGuestReviewArchive2026082200010,
    AddLogArchive2026082400010,
    AddManualBookingGuestName2026082400020,
  ];
}

async function readMigrationHistory(dataSource) {
  const rows = await dataSource.query(
    'SELECT "name" FROM "migrations" ORDER BY "id" ASC',
  );
  return rows.map((row) => String(row.name));
}

async function assertNoBaselineObjects(dataSource) {
  const [tables] = await dataSource.query(`
    SELECT COUNT(*)::int AS count
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name <> 'migrations'
  `);
  if (Number(tables?.count) !== 0) {
    throw new Error(`Fresh baseline revert left ${tables?.count} public business table(s)`);
  }

  const [extension] = await dataSource.query(`
    SELECT EXISTS (
      SELECT 1 FROM pg_extension WHERE extname = 'uuid-ossp'
    ) AS present
  `);
  if (extension?.present) {
    throw new Error('Fresh baseline revert left uuid-ossp installed');
  }
}

export async function runFreshSchemaBaselineValidation(mode, env = process.env) {
  assertFreshSchemaReferenceTarget(env);
  if (env !== process.env) {
    throw new Error('Fresh baseline validation must use process.env after safety validation.');
  }
  if (!['apply', 'revert'].includes(mode)) {
    throw new Error('Mode must be apply or revert');
  }

  const require = createRequire(import.meta.url);
  const { DataSource } = require('typeorm');
  const dataSource = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    username: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_NAME,
    synchronize: false,
    migrations: loadMigrations(require),
  });

  await dataSource.initialize();
  try {
    if (mode === 'apply') {
      const applied = await dataSource.runMigrations({ transaction: 'all' });
      assertMigrationNames(
        applied.map((migration) => migration.name),
        EXPECTED_FRESH_BASELINE_HISTORY,
        'fresh baseline application',
      );
      assertMigrationNames(
        await readMigrationHistory(dataSource),
        EXPECTED_FRESH_BASELINE_HISTORY,
        'fresh baseline history',
      );
      return;
    }

    assertMigrationNames(
      await readMigrationHistory(dataSource),
      EXPECTED_FRESH_BASELINE_HISTORY,
      'pre-revert history',
    );

    for (let index = EXPECTED_FRESH_BASELINE_HISTORY.length - 1; index >= 0; index -= 1) {
      await dataSource.undoLastMigration({ transaction: 'all' });
    }

    assertMigrationNames(
      await readMigrationHistory(dataSource),
      [],
      'post-revert history',
    );
    await assertNoBaselineObjects(dataSource);
  } finally {
    await dataSource.destroy();
  }
}

async function main() {
  const mode = String(process.argv[2] || '').trim();
  await runFreshSchemaBaselineValidation(mode);
  process.stdout.write(`Fresh schema baseline ${mode} completed successfully.\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(
      `Fresh schema baseline validation failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}
