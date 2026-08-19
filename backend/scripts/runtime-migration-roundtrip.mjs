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

const EXPECTED_REWIND_STATE = {
  4: {
    waiterLifecycleTrigger: false,
    waiterLifecycleFunction: false,
  },
  3: {
    waiterAssignmentActiveColumn: false,
    waiterAssignmentIndex: false,
    waiterStatusIndex: true,
  },
  2: {
    waiterCallsTable: false,
  },
  1: {
    staffPinAttemptsTable: true,
    staffPinAttemptCountColumn: true,
    staffPinWindowStartedAtColumn: true,
    staffPinIdColumn: false,
    staffPinStatusColumn: false,
    staffPinUpdatedAtIndex: true,
  },
  0: {
    staffPinAttemptsTable: false,
  },
};

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

export function assertRewindState(actualState, expectedState, label) {
  for (const [key, expectedValue] of Object.entries(expectedState)) {
    if (actualState?.[key] !== expectedValue) {
      throw new Error(
        `Unexpected rewind state ${label}: ${key} expected ${expectedValue}, received ${actualState?.[key]}`,
      );
    }
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

async function readRewindState(dataSource) {
  const [state] = await dataSource.query(`
    SELECT
      to_regclass('public.staff_pin_attempts') IS NOT NULL AS "staffPinAttemptsTable",
      to_regclass('public.waiter_calls') IS NOT NULL AS "waiterCallsTable",
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'staff_pin_attempts'
          AND column_name = 'attempt_count'
      ) AS "staffPinAttemptCountColumn",
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'staff_pin_attempts'
          AND column_name = 'window_started_at'
      ) AS "staffPinWindowStartedAtColumn",
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'staff_pin_attempts'
          AND column_name = 'id'
      ) AS "staffPinIdColumn",
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'staff_pin_attempts'
          AND column_name = 'status'
      ) AS "staffPinStatusColumn",
      EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname = 'IDX_staff_pin_attempts_updated_at'
      ) AS "staffPinUpdatedAtIndex",
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'waiter_calls'
          AND column_name = 'assignment_active'
      ) AS "waiterAssignmentActiveColumn",
      EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname = 'IDX_waiter_calls_waiter_assignment'
      ) AS "waiterAssignmentIndex",
      EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname = 'IDX_waiter_calls_waiter_status'
      ) AS "waiterStatusIndex",
      EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'TRG_bookings_close_waiter_calls_when_inactive'
          AND NOT tgisinternal
      ) AS "waiterLifecycleTrigger",
      EXISTS (
        SELECT 1
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = 'close_waiter_calls_when_booking_inactive'
      ) AS "waiterLifecycleFunction"
  `);
  return state;
}

async function assertRewindCheckpoint(dataSource, remainingMigrationCount) {
  const history = await readMigrationHistory(dataSource);
  assertMigrationHistory(
    history,
    EXPECTED_RUNTIME_MIGRATIONS.slice(0, remainingMigrationCount),
  );

  const state = await readRewindState(dataSource);
  assertRewindState(
    state,
    EXPECTED_REWIND_STATE[remainingMigrationCount],
    `after ${EXPECTED_RUNTIME_MIGRATIONS.length - remainingMigrationCount} undo(s)`,
  );
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

      for (
        let index = EXPECTED_RUNTIME_MIGRATIONS.length - 1;
        index >= 0;
        index -= 1
      ) {
        await dataSource.undoLastMigration({ transaction: 'all' });
        await assertRewindCheckpoint(dataSource, index);
      }
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
