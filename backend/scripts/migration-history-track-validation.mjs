import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

import { assertFreshSchemaReferenceTarget } from './fresh-schema-reference.mjs';
import {
  EXPECTED_FRESH_BASELINE_HISTORY,
  INITIAL_BASELINE_MIGRATION,
} from './fresh-schema-baseline-validation.mjs';
import { EXPECTED_RUNTIME_MIGRATIONS } from './runtime-migration-roundtrip.mjs';

export const FUTURE_MIGRATION_PROBE = 'MigrationHistoryProbe2026081900010';
export const EXPECTED_EXISTING_TRACK_AFTER_PROBE = [
  ...EXPECTED_RUNTIME_MIGRATIONS,
  FUTURE_MIGRATION_PROBE,
];
export const EXPECTED_FRESH_TRACK_AFTER_PROBE = [
  ...EXPECTED_FRESH_BASELINE_HISTORY,
  FUTURE_MIGRATION_PROBE,
];

function assertMigrationNames(actualNames, expectedNames, label) {
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
    throw new Error(
      `Unexpected ${label}. Expected ${JSON.stringify(expectedNames)}, received ${JSON.stringify(actualNames)}`,
    );
  }
}

function loadRuntimeMigrations(require) {
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

  return [
    CreateStaffPinAttempts2026081400010,
    UpgradeStaffPinAttemptsPerAttempt2026081400020,
    CreateWaiterCalls2026081500010,
    AddWaiterCallAssignmentActive2026081500015,
    CloseInactiveWaiterCalls2026081500020,
    AddGuestReviewArchive2026082200010,
  ];
}

function loadInitialBaseline(require) {
  const {
    InitialSchemaBaseline2026081300000,
  } = require('../dist/migrations/2026081300000-InitialSchemaBaseline.js');
  return InitialSchemaBaseline2026081300000;
}

class MigrationHistoryProbe2026081900010 {
  name = FUTURE_MIGRATION_PROBE;

  async up(queryRunner) {
    await queryRunner.query(
      'CREATE TABLE "migration_history_probe" ("id" integer PRIMARY KEY)',
    );
  }

  async down(queryRunner) {
    await queryRunner.query('DROP TABLE "migration_history_probe"');
  }
}

async function readMigrationHistory(dataSource) {
  const rows = await dataSource.query(
    'SELECT "name" FROM "migrations" ORDER BY "id" ASC',
  );
  return rows.map((row) => String(row.name));
}

async function assertProbeTable(dataSource, expectedPresent) {
  const [row] = await dataSource.query(
    `SELECT to_regclass('public.migration_history_probe')::text AS relation_name`,
  );
  const present = Boolean(row?.relation_name);
  if (present !== expectedPresent) {
    throw new Error(
      `Migration history probe table presence expected ${expectedPresent}, received ${present}`,
    );
  }
}

function createDataSource(require, migrations) {
  const { DataSource } = require('typeorm');
  return new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    username: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_NAME,
    synchronize: false,
    migrations,
  });
}

export async function runMigrationHistoryTrackValidation(mode, env = process.env) {
  assertFreshSchemaReferenceTarget(env);
  if (env !== process.env) {
    throw new Error('Migration history track validation must use process.env after safety validation.');
  }
  if (!['existing', 'fresh'].includes(mode)) {
    throw new Error('Mode must be existing or fresh');
  }

  const require = createRequire(import.meta.url);
  const runtimeMigrations = loadRuntimeMigrations(require);
  const migrations =
    mode === 'existing'
      ? [...runtimeMigrations, MigrationHistoryProbe2026081900010]
      : [
          loadInitialBaseline(require),
          ...runtimeMigrations,
          MigrationHistoryProbe2026081900010,
        ];

  const expectedAfter =
    mode === 'existing'
      ? EXPECTED_EXISTING_TRACK_AFTER_PROBE
      : EXPECTED_FRESH_TRACK_AFTER_PROBE;
  const expectedAfterUndo =
    mode === 'existing'
      ? EXPECTED_RUNTIME_MIGRATIONS
      : EXPECTED_FRESH_BASELINE_HISTORY;

  const dataSource = createDataSource(require, migrations);
  await dataSource.initialize();
  try {
    if (mode === 'existing') {
      const before = await readMigrationHistory(dataSource);
      assertMigrationNames(
        before,
        EXPECTED_RUNTIME_MIGRATIONS,
        'existing-track pre-probe history',
      );
      if (before.includes(INITIAL_BASELINE_MIGRATION)) {
        throw new Error('Existing production-style history unexpectedly contains initial baseline');
      }
    }

    const applied = await dataSource.runMigrations({ transaction: 'all' });
    const expectedApplied =
      mode === 'existing'
        ? [FUTURE_MIGRATION_PROBE]
        : EXPECTED_FRESH_TRACK_AFTER_PROBE;
    assertMigrationNames(
      applied.map((migration) => migration.name),
      expectedApplied,
      `${mode}-track applied migrations`,
    );
    assertMigrationNames(
      await readMigrationHistory(dataSource),
      expectedAfter,
      `${mode}-track post-probe history`,
    );
    await assertProbeTable(dataSource, true);

    await dataSource.undoLastMigration({ transaction: 'all' });
    assertMigrationNames(
      await readMigrationHistory(dataSource),
      expectedAfterUndo,
      `${mode}-track post-probe-undo history`,
    );
    await assertProbeTable(dataSource, false);
  } finally {
    await dataSource.destroy();
  }
}

async function main() {
  const mode = String(process.argv[2] || '').trim();
  await runMigrationHistoryTrackValidation(mode);
  process.stdout.write(`Migration history ${mode} track validation completed successfully.\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(
      `Migration history track validation failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}
