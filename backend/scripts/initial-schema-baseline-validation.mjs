import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

import { assertFreshSchemaReferenceTarget } from './fresh-schema-reference.mjs';
import { EXPECTED_RUNTIME_MIGRATIONS } from './runtime-migration-roundtrip.mjs';

export const INITIAL_BASELINE_MIGRATION = 'InitialSchemaBaseline2026081300000';
export const EXPECTED_FRESH_BASELINE_HISTORY = [
  INITIAL_BASELINE_MIGRATION,
  ...EXPECTED_RUNTIME_MIGRATIONS,
];
export const EXPECTED_ADOPTED_BASELINE_HISTORY = [
  ...EXPECTED_RUNTIME_MIGRATIONS,
  INITIAL_BASELINE_MIGRATION,
];

export function assertMigrationNames(actualNames, expectedNames, label = 'migration history') {
  const actual = JSON.stringify(actualNames);
  const expected = JSON.stringify(expectedNames);
  if (actual !== expected) {
    throw new Error(`Unexpected ${label}. Expected ${expected}, received ${actual}`);
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

  return [
    InitialSchemaBaseline2026081300000,
    CreateStaffPinAttempts2026081400010,
    UpgradeStaffPinAttemptsPerAttempt2026081400020,
    CreateWaiterCalls2026081500010,
    AddWaiterCallAssignmentActive2026081500015,
    CloseInactiveWaiterCalls2026081500020,
  ];
}

async function readMigrationHistory(dataSource) {
  const rows = await dataSource.query('SELECT "name" FROM "migrations" ORDER BY "id" ASC');
  return rows.map((row) => String(row.name));
}

async function assertNoBaselineBusinessTables(dataSource) {
  const [row] = await dataSource.query(`
    SELECT COUNT(*)::int AS count
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name <> 'migrations'
  `);
  if (Number(row?.count) !== 0) {
    throw new Error(`Baseline revert left ${row?.count} public business table(s)`);
  }
}

async function assertUuidOsspAbsent(dataSource) {
  const [row] = await dataSource.query(`
    SELECT EXISTS (
      SELECT 1 FROM pg_extension WHERE extname = 'uuid-ossp'
    ) AS present
  `);
  if (row?.present) {
    throw new Error('Fresh baseline revert left uuid-ossp extension installed');
  }
}

export async function runInitialBaselineValidation(mode, env = process.env) {
  assertFreshSchemaReferenceTarget(env);
  if (env !== process.env) {
    throw new Error('Initial baseline validation must use process.env after safety validation.');
  }
  if (!['adopt', 'revert-adopted', 'fresh', 'revert'].includes(mode)) {
    throw new Error('Mode must be adopt, revert-adopted, fresh or revert');
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
    if (mode === 'adopt') {
      const before = await readMigrationHistory(dataSource);
      assertMigrationNames(before, EXPECTED_RUNTIME_MIGRATIONS, 'pre-adoption history');

      const applied = await dataSource.runMigrations({ transaction: 'all' });
      assertMigrationNames(
        applied.map((migration) => migration.name),
        [INITIAL_BASELINE_MIGRATION],
        'adoption result',
      );

      const after = await readMigrationHistory(dataSource);
      assertMigrationNames(
        after,
        EXPECTED_ADOPTED_BASELINE_HISTORY,
        'post-adoption history',
      );
      return;
    }

    if (mode === 'revert-adopted') {
      const before = await readMigrationHistory(dataSource);
      assertMigrationNames(
        before,
        EXPECTED_ADOPTED_BASELINE_HISTORY,
        'pre-adopted-revert history',
      );

      await dataSource.undoLastMigration({ transaction: 'all' });

      const after = await readMigrationHistory(dataSource);
      assertMigrationNames(
        after,
        EXPECTED_RUNTIME_MIGRATIONS,
        'post-adopted-revert history',
      );
      return;
    }

    if (mode === 'fresh') {
      const applied = await dataSource.runMigrations({ transaction: 'all' });
      assertMigrationNames(
        applied.map((migration) => migration.name),
        EXPECTED_FRESH_BASELINE_HISTORY,
        'fresh baseline application',
      );
      const after = await readMigrationHistory(dataSource);
      assertMigrationNames(after, EXPECTED_FRESH_BASELINE_HISTORY, 'fresh baseline history');
      return;
    }

    const before = await readMigrationHistory(dataSource);
    assertMigrationNames(before, EXPECTED_FRESH_BASELINE_HISTORY, 'pre-revert history');

    for (let index = EXPECTED_FRESH_BASELINE_HISTORY.length - 1; index >= 0; index -= 1) {
      await dataSource.undoLastMigration({ transaction: 'all' });
    }

    const after = await readMigrationHistory(dataSource);
    assertMigrationNames(after, [], 'post-revert history');
    await assertNoBaselineBusinessTables(dataSource);
    await assertUuidOsspAbsent(dataSource);
  } finally {
    await dataSource.destroy();
  }
}

async function main() {
  const mode = String(process.argv[2] || '').trim();
  await runInitialBaselineValidation(mode);
  process.stdout.write(`Initial schema baseline ${mode} validation completed successfully.\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(
      `Initial schema baseline validation failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}
