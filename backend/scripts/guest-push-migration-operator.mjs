import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

export const PUSH_MIGRATION = 'CreateGuestPushSubscriptions2026092000010';
export const EXISTING_HISTORY = [
  'CreateStaffPinAttempts2026081400010',
  'UpgradeStaffPinAttemptsPerAttempt2026081400020',
  'CreateWaiterCalls2026081500010',
  'AddWaiterCallAssignmentActive2026081500015',
  'CloseInactiveWaiterCalls2026081500020',
  'AddGuestReviewArchive2026082200010',
  'AddLogArchive2026082400010',
  'AddManualBookingGuestName2026082400020',
];

export class OperatorGuardError extends Error {}

export function assertOperatorIntent(mode, env) {
  if (!['--check', '--apply'].includes(mode)) {
    throw new OperatorGuardError('Use --check (default) or --apply only.');
  }
  const branch = String(env.MOLO_PUSH_BRANCH || '').trim();
  if (!['production', 'test-push-migration'].includes(branch)) {
    throw new OperatorGuardError('Set MOLO_PUSH_BRANCH to the verified Neon branch name.');
  }
  const expectedHost = String(env.MOLO_PUSH_EXPECTED_HOST || '').trim().toLowerCase();
  if (!expectedHost || !expectedHost.endsWith('.neon.tech')) {
    throw new OperatorGuardError('Set MOLO_PUSH_EXPECTED_HOST to the Neon branch endpoint hostname.');
  }
  let connection;
  try {
    connection = new URL(String(env.DB_URL || ''));
  } catch {
    throw new OperatorGuardError('A private Neon DB_URL must be provided.');
  }
  if (
    !['postgres:', 'postgresql:'].includes(connection.protocol) ||
    !connection.username ||
    !connection.password ||
    connection.hostname.toLowerCase() !== expectedHost ||
    !connection.pathname.slice(1)
  ) {
    throw new OperatorGuardError('DB_URL does not match the expected Neon branch endpoint.');
  }
  if (!['require', 'verify-full'].includes(connection.searchParams.get('sslmode'))) {
    throw new OperatorGuardError('Neon DB_URL must require SSL.');
  }
  if (String(env.DB_SYNCHRONIZE || '').toLowerCase() === 'true') {
    throw new OperatorGuardError('This operator refuses DB_SYNCHRONIZE=true.');
  }
  if (mode === '--apply') {
    if (env.MOLO_PUSH_APPROVAL !== `apply-guest-push-subscriptions-to-${branch}`) {
      throw new OperatorGuardError('Manual approval phrase does not match the selected branch.');
    }
    if (
      branch === 'production' &&
      (env.MOLO_PUSH_BACKUP_CONFIRMED !== 'yes' ||
        env.MOLO_PUSH_PRODUCTION_CHANGE_APPROVED !== 'yes')
    ) {
      throw new OperatorGuardError('Production requires a fresh verified backup and separate change approval.');
    }
  }
  // A hostname comparison cannot prove branch identity: the operator must check Neon UI.
  return { branch, url: String(env.DB_URL) };
}

export function assertMigrationHistory(rows, after = false) {
  const expected = after ? [...EXISTING_HISTORY, PUSH_MIGRATION] : EXISTING_HISTORY;
  if (
    !Array.isArray(rows) ||
    rows.length !== expected.length ||
    rows.some((row, index) =>
      Number(row.id) !== index + 1 ||
      Number(row.timestamp) !== Number(expected[index].match(/\d{13}$/)?.[0]) ||
      row.name !== expected[index],
    )
  ) {
    throw new OperatorGuardError('Migration history differs from the audited eight-migration baseline. Stop and re-audit.');
  }
}

export async function assertSchema(queryRunner, after = false) {
  const [state] = await queryRunner.query(`
    SELECT current_schema() AS "schemaName",
      to_regclass('public.guest_push_subscriptions') IS NOT NULL AS "pushTable",
      EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = to_regclass('public.bookings')
          AND attname = 'id' AND atttypid = 'uuid'::regtype AND NOT attisdropped
      ) AS "bookingUuid",
      EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'FK_guest_push_subscriptions_booking'
          AND conrelid = to_regclass('public.guest_push_subscriptions')
          AND contype = 'f'
      ) AS "bookingLink"
  `);
  if (
    state?.schemaName !== 'public' ||
    state?.bookingUuid !== true ||
    state?.pushTable !== after ||
    (after && state?.bookingLink !== true)
  ) {
    throw new OperatorGuardError('Database schema is not in the expected state. Stop and re-audit.');
  }
}

async function assertPreflight(queryRunner) {
  const rows = await queryRunner.query('SELECT id, "timestamp", name FROM public.migrations ORDER BY id');
  assertMigrationHistory(rows);
  await assertSchema(queryRunner);
}

export async function operateGuestPushMigration(mode = '--check', env = process.env) {
  if (env !== process.env) {
    throw new OperatorGuardError('The operator must use the validated process environment.');
  }
  const target = assertOperatorIntent(mode, env);
  const require = createRequire(import.meta.url);
  const { DataSource, MigrationExecutor } = require('typeorm');
  const { CreateGuestPushSubscriptions2026092000010 } = require(
    '../dist/migrations/2026092000010-CreateGuestPushSubscriptions.js'
  );
  // Isolated data source: no Nest bootstrap, auto-load, synchronize or other migrations.
  const dataSource = new DataSource({
    type: 'postgres',
    url: target.url,
    ssl: { rejectUnauthorized: true },
    synchronize: false,
    logging: false,
    migrations: [CreateGuestPushSubscriptions2026092000010],
  });
  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();
  try {
    await runner.connect();
    if (mode === '--check') {
      await assertPreflight(runner);
      return 'Preflight passed; no changes made.';
    }

    await runner.startTransaction();
    try {
      await runner.query("SET LOCAL lock_timeout = '5s'");
      await runner.query("SET LOCAL statement_timeout = '30s'");
      // Same lock and order as the live application migration bootstrap.
      await runner.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [
        'molo', 'schema-migrations',
      ]);
      await runner.query('LOCK TABLE public.migrations IN SHARE ROW EXCLUSIVE MODE');
      await assertPreflight(runner);
      const executor = new MigrationExecutor(dataSource, runner);
      executor.transaction = 'none'; // The outer transaction owns all SQL and history writes.
      const applied = await executor.executePendingMigrations();
      if (applied.length !== 1 || applied[0].name !== PUSH_MIGRATION) {
        throw new OperatorGuardError('Unexpected migration execution; rolling back.');
      }
      const after = await runner.query('SELECT id, "timestamp", name FROM public.migrations ORDER BY id');
      assertMigrationHistory(after, true);
      await assertSchema(runner, true);
      await runner.commitTransaction();
      return 'Guest Push table migration committed and verified.';
    } catch (error) {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      throw error;
    }
  } finally {
    await runner.release();
    await dataSource.destroy();
  }
}

async function main() {
  const mode = process.argv[2] || '--check';
  try {
    process.stdout.write(`${await operateGuestPushMigration(mode)}\n`);
  } catch (error) {
    // Never print driver errors: they can embed credentials or connection strings.
    console.error(error instanceof OperatorGuardError ? error.message : 'Migration operation failed; inspect private database logs.');
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
