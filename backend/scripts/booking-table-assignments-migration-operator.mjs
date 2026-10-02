import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { buildReviewedArtifacts } from './syrve-application-build.mjs';

export const BANQUET_MIGRATION = 'CreateBookingTableAssignments2026100200010';
export const GUEST_PUSH_MIGRATION = 'CreateGuestPushSubscriptions2026092000010';

const LEGACY_HISTORY = [
  'CreateStaffPinAttempts2026081400010',
  'UpgradeStaffPinAttemptsPerAttempt2026081400020',
  'CreateWaiterCalls2026081500010',
  'AddWaiterCallAssignmentActive2026081500015',
  'CloseInactiveWaiterCalls2026081500020',
  'AddGuestReviewArchive2026082200010',
  'AddLogArchive2026082400010',
  'AddManualBookingGuestName2026082400020',
];
const SYRVE_HISTORY = [
  'CreateSyrveTableLinks2026093000010',
  'FenceSyrveConfiguration2026093000020',
  'CreateTableMapIdentities2026093000030',
  'ProtectCanonicalTableNumbers2026093000040',
  'CreateSyrveDurableState2026093000050',
  'CreateSyrveWorkerState2026100100060',
];

export const ACCEPTED_PRE_BANQUET_HISTORIES = [
  [...LEGACY_HISTORY, ...SYRVE_HISTORY],
  [...LEGACY_HISTORY, GUEST_PUSH_MIGRATION, ...SYRVE_HISTORY],
];

export class BanquetMigrationOperatorError extends Error {}

const sameNames = (left, right) =>
  left.length === right.length && left.every((value, index) => value === right[index]);

export function assertBanquetMigrationHistory(rows, after = false) {
  if (!Array.isArray(rows)) {
    throw new BanquetMigrationOperatorError('Migration history is unavailable. Stop and re-audit.');
  }
  const names = rows.map((row) => String(row.name));
  const beforeNames = after ? names.slice(0, -1) : names;
  const expected = ACCEPTED_PRE_BANQUET_HISTORIES.find((candidate) => sameNames(candidate, beforeNames));
  if (!expected || (after && names.at(-1) !== BANQUET_MIGRATION)) {
    throw new BanquetMigrationOperatorError('Migration history differs from the reviewed pre-banquet baseline. Stop and re-audit.');
  }
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const id = Number(row.id);
    const timestamp = Number(row.timestamp);
    const expectedTimestamp = Number(String(row.name).match(/\d{13}$/)?.[0]);
    if (!Number.isSafeInteger(id) || id <= 0 || (index > 0 && id <= Number(rows[index - 1].id))
      || timestamp !== expectedTimestamp) {
      throw new BanquetMigrationOperatorError('Migration history IDs or timestamps require a separate audit.');
    }
  }
  return expected;
}

export function assertBanquetOperatorIntent(mode, env, now = Date.now()) {
  if (!['--check', '--apply', '--verify'].includes(mode)) {
    throw new BanquetMigrationOperatorError('Use --check, --apply or --verify only.');
  }
  const branch = String(env.MOLO_BANQUET_BRANCH || '').trim();
  if (!['production', 'test-banquet-migration'].includes(branch)) {
    throw new BanquetMigrationOperatorError('Select the verified production or test-banquet-migration Neon branch.');
  }
  const expectedHost = String(env.MOLO_BANQUET_EXPECTED_HOST || '').trim().toLowerCase();
  const expectedDatabase = String(env.MOLO_BANQUET_EXPECTED_DATABASE || '').trim();
  if (!expectedHost.endsWith('.neon.tech') || !expectedDatabase) {
    throw new BanquetMigrationOperatorError('Provide the independently verified Neon host and database.');
  }

  let connection;
  try {
    connection = new URL(String(env.DB_URL || ''));
  } catch {
    throw new BanquetMigrationOperatorError('Provide the private verified Neon connection.');
  }
  let actualDatabase;
  try {
    actualDatabase = decodeURIComponent(connection.pathname.slice(1));
  } catch {
    throw new BanquetMigrationOperatorError('Invalid database target.');
  }
  if (!['postgres:', 'postgresql:'].includes(connection.protocol)
    || !connection.username || !connection.password
    || connection.hostname.toLowerCase() !== expectedHost
    || actualDatabase !== expectedDatabase
    || connection.hash || (connection.port && connection.port !== '5432')
    || [...connection.searchParams.keys()].some((key) => key !== 'sslmode')
    || !['require', 'verify-full'].includes(connection.searchParams.get('sslmode'))) {
    throw new BanquetMigrationOperatorError('Connection does not match the verified Neon target and TLS requirements.');
  }
  if (String(env.DB_SYNCHRONIZE || '').trim().toLowerCase() !== 'false') {
    throw new BanquetMigrationOperatorError('Set DB_SYNCHRONIZE=false for the banquet migration operator.');
  }

  if (mode === '--apply') {
    const approval = `apply-booking-table-assignments-to-${branch}`;
    if (env.MOLO_BANQUET_APPROVAL !== approval) {
      throw new BanquetMigrationOperatorError('Manual approval phrase does not match the selected branch.');
    }
    if (branch === 'production') {
      if (env.MOLO_BANQUET_BACKUP_CONFIRMED !== 'yes'
        || env.MOLO_BANQUET_REHEARSAL_CONFIRMED !== 'yes'
        || env.MOLO_BANQUET_PRODUCTION_CHANGE_APPROVED !== 'yes') {
        throw new BanquetMigrationOperatorError('Production requires a fresh backup, restored rehearsal and separate change approval.');
      }
      const verifiedAt = Date.parse(String(env.MOLO_BANQUET_BACKUP_VERIFIED_AT || ''));
      if (!Number.isFinite(verifiedAt) || verifiedAt > now + 300_000 || now - verifiedAt > 3_600_000) {
        throw new BanquetMigrationOperatorError('Production backup verification must be fresh within one hour.');
      }
    }
  }

  connection.search = '';
  return { branch, database: expectedDatabase, url: connection.toString() };
}

export function assertReviewedBanquetCheckout(env, actualHead, status) {
  const reviewed = String(env.MOLO_BANQUET_REVIEWED_COMMIT || '').trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(reviewed) || String(actualHead).trim().toLowerCase() !== reviewed) {
    throw new BanquetMigrationOperatorError('Run the operator from the exact reviewed git commit.');
  }
  if (String(status || '').trim()) {
    throw new BanquetMigrationOperatorError('The reviewed checkout must have no uncommitted changes.');
  }
  return reviewed;
}

export function assertReviewedBanquetBuild(env, build) {
  const reviewed = String(env.MOLO_BANQUET_REVIEWED_COMMIT || '').trim().toLowerCase();
  if (!build || build.sourceCommit !== reviewed || !/^[0-9a-f]{40}$/.test(build.sourceTree || '')
    || !/^[0-9a-f]{64}$/.test(build.artifactFingerprint || '')) {
    throw new BanquetMigrationOperatorError('Compiled backend artifacts do not match the exact reviewed commit.');
  }
  return build;
}

function buildBanquetArtifacts(env) {
  try {
    // Reuse the existing reviewed full-backend build: it deletes dist and
    // incremental state, rebuilds from the clean checkout, fingerprints every
    // emitted artifact and binds the result to the current git commit/tree.
    return assertReviewedBanquetBuild(env, buildReviewedArtifacts());
  } catch (error) {
    if (error instanceof BanquetMigrationOperatorError) throw error;
    throw new BanquetMigrationOperatorError('Reviewed backend build failed before database connection.');
  }
}

function readCheckoutState() {
  const root = fileURLToPath(new URL('../..', import.meta.url));
  return {
    head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    status: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }),
  };
}

async function readHistory(queryRunner) {
  return queryRunner.query('SELECT id, "timestamp", name FROM public.migrations ORDER BY id');
}

export async function assertBookingTableAssignmentsSchema(queryRunner, after = false) {
  const [base] = await queryRunner.query(`
    SELECT current_schema() AS "schemaName",
      to_regclass('public.booking_table_assignments') IS NOT NULL AS "assignmentTable",
      to_regprocedure('public.uuid_generate_v4()') IS NOT NULL AS "uuidGenerator",
      EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = to_regclass('public.bookings')
          AND attname = 'id' AND atttypid = 'uuid'::regtype AND NOT attisdropped
      ) AS "bookingUuid",
      EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = to_regclass('public.bookings')
          AND attname = 'table_id' AND atttypid = 'uuid'::regtype AND NOT attisdropped
      ) AS "bookingTableUuid",
      EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = to_regclass('public.tables')
          AND attname = 'id' AND atttypid = 'uuid'::regtype AND NOT attisdropped
      ) AS "tableUuid"
  `);
  if (base?.schemaName !== 'public' || base?.uuidGenerator !== true
    || base?.bookingUuid !== true || base?.bookingTableUuid !== true || base?.tableUuid !== true
    || base?.assignmentTable !== after) {
    throw new BanquetMigrationOperatorError('Database schema is not in the expected banquet migration state.');
  }
  if (!after) return;

  const [schema] = await queryRunner.query(`
    SELECT
      (SELECT count(*)::int FROM information_schema.columns
        WHERE table_schema='public' AND table_name='booking_table_assignments') = 5 AS "exactColumns",
      (
        SELECT count(*) = 5 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='booking_table_assignments'
          AND (
            (column_name='id' AND data_type='uuid' AND is_nullable='NO' AND column_default LIKE '%uuid_generate_v4()%')
            OR (column_name='booking_id' AND data_type='uuid' AND is_nullable='NO')
            OR (column_name='table_id' AND data_type='uuid' AND is_nullable='NO')
            OR (column_name='is_primary' AND data_type='boolean' AND is_nullable='NO' AND column_default='false')
            OR (column_name='created_at' AND data_type='timestamp without time zone' AND is_nullable='NO' AND column_default='now()')
          )
      ) AS "columnShape",
      EXISTS (
        SELECT 1 FROM pg_constraint k
        WHERE k.conname='PK_booking_table_assignments'
          AND k.conrelid='public.booking_table_assignments'::regclass
          AND k.contype='p' AND k.convalidated AND NOT k.condeferrable AND NOT k.condeferred
          AND k.conkey = ARRAY[
            (SELECT attnum FROM pg_attribute
             WHERE attrelid='public.booking_table_assignments'::regclass
               AND attname='id' AND NOT attisdropped)
          ]::smallint[]
      ) AS "primaryKey",
      EXISTS (
        SELECT 1 FROM pg_constraint k
        WHERE k.conname='FK_booking_table_assignments_booking'
          AND k.conrelid='public.booking_table_assignments'::regclass
          AND k.confrelid='public.bookings'::regclass
          AND k.contype='f' AND k.convalidated AND NOT k.condeferrable AND NOT k.condeferred
          AND k.confmatchtype='s' AND k.confupdtype='a' AND k.confdeltype='c'
          AND k.conkey = ARRAY[
            (SELECT attnum FROM pg_attribute
             WHERE attrelid='public.booking_table_assignments'::regclass
               AND attname='booking_id' AND NOT attisdropped)
          ]::smallint[]
          AND k.confkey = ARRAY[
            (SELECT attnum FROM pg_attribute
             WHERE attrelid='public.bookings'::regclass
               AND attname='id' AND NOT attisdropped)
          ]::smallint[]
      ) AS "bookingForeignKey",
      EXISTS (
        SELECT 1 FROM pg_constraint k
        WHERE k.conname='FK_booking_table_assignments_table'
          AND k.conrelid='public.booking_table_assignments'::regclass
          AND k.confrelid='public.tables'::regclass
          AND k.contype='f' AND k.convalidated AND NOT k.condeferrable AND NOT k.condeferred
          AND k.confmatchtype='s' AND k.confupdtype='a' AND k.confdeltype='c'
          AND k.conkey = ARRAY[
            (SELECT attnum FROM pg_attribute
             WHERE attrelid='public.booking_table_assignments'::regclass
               AND attname='table_id' AND NOT attisdropped)
          ]::smallint[]
          AND k.confkey = ARRAY[
            (SELECT attnum FROM pg_attribute
             WHERE attrelid='public.tables'::regclass
               AND attname='id' AND NOT attisdropped)
          ]::smallint[]
      ) AS "tableForeignKey",
      EXISTS (
        SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
        WHERE c.oid=to_regclass('public."UQ_booking_table_assignments_booking_table"')
          AND i.indisunique AND i.indisvalid AND i.indisready AND i.indpred IS NULL
          AND pg_get_indexdef(c.oid) LIKE '%(booking_id, table_id)'
      ) AS "pairIndex",
      EXISTS (
        SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
        WHERE c.oid=to_regclass('public."UQ_booking_table_assignments_primary_booking"')
          AND i.indisunique AND i.indisvalid AND i.indisready AND i.indpred IS NOT NULL
          AND pg_get_indexdef(c.oid) LIKE '%(booking_id) WHERE (is_primary = true)'
      ) AS "primaryIndex",
      EXISTS (
        SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
        WHERE c.oid=to_regclass('public."IDX_booking_table_assignments_table"')
          AND NOT i.indisunique AND i.indisvalid AND i.indisready AND i.indpred IS NULL
          AND pg_get_indexdef(c.oid) LIKE '%(table_id)'
      ) AS "tableIndex"
  `);
  if (!schema?.exactColumns || !schema?.columnShape || !schema?.primaryKey
    || !schema?.bookingForeignKey || !schema?.tableForeignKey
    || !schema?.pairIndex || !schema?.primaryIndex || !schema?.tableIndex) {
    throw new BanquetMigrationOperatorError('Banquet assignment columns, constraints or indexes do not match the reviewed migration.');
  }

  const [data] = await queryRunner.query(`
    SELECT
      (SELECT count(*)::int FROM public.bookings WHERE table_id IS NOT NULL) AS "legacyBookings",
      (SELECT count(*)::int FROM public.booking_table_assignments) AS "assignments",
      NOT EXISTS (
        (SELECT id AS booking_id, table_id FROM public.bookings WHERE table_id IS NOT NULL
         EXCEPT
         SELECT booking_id, table_id FROM public.booking_table_assignments WHERE is_primary = true)
        UNION ALL
        (SELECT booking_id, table_id FROM public.booking_table_assignments WHERE is_primary = true
         EXCEPT
         SELECT id AS booking_id, table_id FROM public.bookings WHERE table_id IS NOT NULL)
      ) AS "primaryCoverage",
      NOT EXISTS (
        SELECT 1 FROM public.booking_table_assignments WHERE is_primary = false
      ) AS "noSecondaryAssignments"
  `);
  if (data?.legacyBookings !== data?.assignments || data?.primaryCoverage !== true || data?.noSecondaryAssignments !== true) {
    throw new BanquetMigrationOperatorError('Banquet assignment backfill does not exactly match existing booking tables.');
  }
}

async function assertPreflight(queryRunner, after) {
  const rows = await readHistory(queryRunner);
  assertBanquetMigrationHistory(rows, after);
  await assertBookingTableAssignmentsSchema(queryRunner, after);
  return rows;
}

export async function operateBookingTableAssignmentsMigration(mode = '--check', env = process.env) {
  if (env !== process.env) {
    throw new BanquetMigrationOperatorError('The operator must use the validated process environment.');
  }
  const target = assertBanquetOperatorIntent(mode, env);
  const checkout = readCheckoutState();
  assertReviewedBanquetCheckout(env, checkout.head, checkout.status);
  buildBanquetArtifacts(env);

  const require = createRequire(import.meta.url);
  const { DataSource, MigrationExecutor } = require('typeorm');
  const { CreateBookingTableAssignments2026100200010 } = require(
    '../dist/migrations/2026100200010-CreateBookingTableAssignments.js'
  );
  const dataSource = new DataSource({
    type: 'postgres',
    url: target.url,
    ssl: { rejectUnauthorized: true },
    synchronize: false,
    logging: false,
    migrations: [CreateBookingTableAssignments2026100200010],
    extra: { connectionTimeoutMillis: 5000, statement_timeout: 30000 },
  });

  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();
  try {
    await runner.connect();

    if (mode !== '--apply') {
      await runner.startTransaction('REPEATABLE READ');
      try {
        await runner.query('SET TRANSACTION READ ONLY');
        await runner.query('SET LOCAL search_path = public, pg_catalog');
        await runner.query("SET LOCAL lock_timeout = '750ms'");
        await runner.query("SET LOCAL statement_timeout = '5s'");
        await assertPreflight(runner, mode === '--verify');
      } finally {
        if (runner.isTransactionActive) await runner.rollbackTransaction();
      }
      return mode === '--verify'
        ? 'Verification passed; no changes made.'
        : 'Preflight passed; no changes made.';
    }

    await runner.startTransaction('READ COMMITTED');
    try {
      await runner.query('SET LOCAL search_path = public, pg_catalog');
      await runner.query("SET LOCAL lock_timeout = '5s'");
      await runner.query("SET LOCAL statement_timeout = '30s'");
      // Bridge both migration fences already used by reviewed MOLO operators.
      await runner.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', ['molo', 'schema-migrations']);
      await runner.query("SELECT pg_advisory_xact_lock(hashtextextended('molo/schema-migrations', 0))");
      await runner.query('LOCK TABLE public.migrations IN SHARE ROW EXCLUSIVE MODE');

      const before = await assertPreflight(runner, false);
      const executor = new MigrationExecutor(dataSource, runner);
      executor.transaction = 'none';
      const applied = await executor.executePendingMigrations();
      if (applied.length !== 1 || applied[0].name !== BANQUET_MIGRATION) {
        throw new BanquetMigrationOperatorError('Unexpected migration execution; rolling back.');
      }

      const after = await assertPreflight(runner, true);
      if (JSON.stringify(after.slice(0, before.length)) !== JSON.stringify(before)) {
        throw new BanquetMigrationOperatorError('Existing migration history changed; rolling back.');
      }
      await runner.commitTransaction();
      return 'Booking table assignment migration committed and verified.';
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
    process.stdout.write(`${await operateBookingTableAssignmentsMigration(mode)}\n`);
  } catch (error) {
    console.error(error instanceof BanquetMigrationOperatorError
      ? error.message
      : 'Banquet migration operation failed; inspect private database logs.');
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
