import { createHash } from 'node:crypto';
import { QueryRunner } from 'typeorm';

export const UUID_OSSP_ADOPTION_FINGERPRINT =
  'e3d634d22d96bb043c9a22b9a2a5bdf04533d1403e9ec499d45a4f50fe836770';

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  return Object.keys(value as Record<string, unknown>)
    .sort()
    .reduce<Record<string, unknown>>((result, key) => {
      result[key] = canonicalize((value as Record<string, unknown>)[key]);
      return result;
    }, {});
}

async function collectUuidOsspFunctionShape(queryRunner: QueryRunner) {
  return queryRunner.query(`
    SELECT
      extension_row.extname AS extension_name,
      function_namespace.nspname AS schema_name,
      function_row.proname AS function_name,
      pg_get_function_identity_arguments(function_row.oid) AS identity_arguments,
      pg_get_function_result(function_row.oid) AS result_type,
      function_row.prokind AS function_kind,
      function_row.provolatile AS volatility,
      function_row.proparallel AS parallel_safety,
      function_row.prosecdef AS security_definer,
      function_row.proleakproof AS leakproof,
      function_row.proisstrict AS strict,
      pg_get_functiondef(function_row.oid) AS definition
    FROM pg_proc AS function_row
    JOIN pg_namespace AS function_namespace
      ON function_namespace.oid = function_row.pronamespace
    JOIN pg_depend AS dependency
      ON dependency.classid = 'pg_proc'::regclass
      AND dependency.objid = function_row.oid
      AND dependency.refclassid = 'pg_extension'::regclass
      AND dependency.deptype = 'e'
    JOIN pg_extension AS extension_row
      ON extension_row.oid = dependency.refobjid
    WHERE extension_row.extname = 'uuid-ossp'
      AND function_namespace.nspname = 'public'
    ORDER BY
      function_row.proname,
      pg_get_function_identity_arguments(function_row.oid)
  `);
}

export async function uuidOsspAdoptionFingerprint(
  queryRunner: QueryRunner,
): Promise<string> {
  const shape = canonicalize(await collectUuidOsspFunctionShape(queryRunner));
  return createHash('sha256').update(JSON.stringify(shape)).digest('hex');
}

export async function assertUuidOsspMatchesAdoptionReference(
  queryRunner: QueryRunner,
): Promise<void> {
  const actual = await uuidOsspAdoptionFingerprint(queryRunner);
  if (actual !== UUID_OSSP_ADOPTION_FINGERPRINT) {
    throw new Error(
      `uuid-ossp functions do not match the approved adoption reference (${actual})`,
    );
  }
}
