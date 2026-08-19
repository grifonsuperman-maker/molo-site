import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

import { assertFreshSchemaReferenceTarget } from './fresh-schema-reference.mjs';

export const EXPECTED_RUNTIME_MIGRATIONS = [
  'CreateStaffPinAttempts2026081400010',
  'UpgradeStaffPinAttemptsPerAttempt2026081400020',
  'CreateWaiterCalls2026081500010',
  'AddWaiterCallAssignmentActive2026081500015',
  'CloseInactiveWaiterCalls2026081500020',
];

export function assertMigrationHistory(actualNames, expectedNames) {
  if (!Array.isArray(actualNames) || !Array.isArray(expectedNames)) {
    throw new Error('Migration history comparison requires arrays');
  }

  const actual = JSON.stringify(actualNames);
  const expected = JSON.stringify(expectedNames);
  if (actual !== expected) {
    throw new Error(
      `Unexpected migration history. Expected ${expected}, received ${actual}`,
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

  return [
    CreateStaffPinAttempts2026081400010,
    UpgradeStaffPinAttemptsPerAttempt2026081400020,
    CreateWaiterCalls2026081500010,
    AddWaiterCallAssignmentActive2026081500015,
    CloseInactiveWaiterCalls2026081500020,
  ];
}

async function readMigrationHistory(dataSource) {
  const rows = await dataSource.query(
    'SELECT "name" FROM "migrations" ORDER BY "id" ASC',
  );
  return rows.map((row) => String(row.name));
}

export async function runRuntimeMigrationRoundtripStep(
  mode,
  env = process.env,
) {
  assertFreshSchemaReferenceTarget(env);

  if (env !== process.env) {
    throw new Error(
      'Runtime migration roundtrip must use process.env after safety validation.',
    );
  }

  if (!['rewind', 'forward'].includes(mode)) {
    throw new Error('Mode must be either rewind or forward');
  }

  const require = createRequire(import.meta.url);
  const { DataSource } = require('typeorm');
  const migrations = loadRuntimeMigrations(require);
  const dataSource = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    username: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_NAME,
    synchronize: false,
    migrations,
  });

  await dataSource.initialize();
  try {
    const before = await readMigrationHistory(dataSource);

    if (mode === 'rewind') {
      assertMigrationHistory(before, EXPECTED_RUNTIME_MIGRATIONS);

      for (let index = EXPECTED_RUNTIME_MIGRATIONS.length - 1; index >= 0; index -= 1) {
        await dataSource.undoLastMigration({ transaction: 'all' });
      }

      const after = await readMigrationHistory(dataSource);
      assertMigrationHistory(after, []);
      return;
    }

    assertMigrationHistory(before, []);
    const applied = await dataSource.runMigrations({ transaction: 'all' });
    assertMigrationHistory(
      applied.map((migration) => migration.name),
      EXPECTED_RUNTIME_MIGRATIONS,
    );

    const after = await readMigrationHistory(dataSource);
    assertMigrationHistory(after, EXPECTED_RUNTIME_MIGRATIONS);
  } finally {
    await dataSource.destroy();
  }
}

async function main() {
  const mode = String(process.argv[2] || '').trim();
  await runRuntimeMigrationRoundtripStep(mode);
  process.stdout.write(`Runtime migrations ${mode} completed successfully.\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(
      `Runtime migration roundtrip failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}
