import { createHash } from 'node:crypto';
import { QueryRunner } from 'typeorm';

export const UUID_OSSP_ADOPTION_FINGERPRINT =
  '502e4e1133e3fae5e19abee1edff830bb64cc1d3b54ebbe160ea860d12b8c3ef';

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

async function collectUuidOsspShape(queryRunner: QueryRunner) {
  const functions = await queryRunner.query(`
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
      function_row.proowner = (SELECT usesysid FROM pg_user WHERE usename = current_user)
        AS owned_by_current_user,
      has_function_privilege(current_user, function_row.oid, 'EXECUTE')
        AS current_user_can_execute,
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

  const privileges = await queryRunner.query(`
    SELECT
      function_row.proname AS function_name,
      pg_get_function_identity_arguments(function_row.oid) AS identity_arguments,
      CASE
        WHEN acl_row.grantee = 0 THEN 'PUBLIC'
        WHEN acl_row.grantee = function_row.proowner THEN 'OWNER'
        WHEN acl_row.grantee = (SELECT usesysid FROM pg_user WHERE usename = current_user)
          THEN 'CURRENT_USER'
        ELSE pg_get_userbyid(acl_row.grantee)
      END AS grantee,
      CASE
        WHEN acl_row.grantor = function_row.proowner THEN 'OWNER'
        WHEN acl_row.grantor = (SELECT usesysid FROM pg_user WHERE usename = current_user)
          THEN 'CURRENT_USER'
        ELSE pg_get_userbyid(acl_row.grantor)
      END AS grantor,
      acl_row.privilege_type,
      acl_row.is_grantable
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
    CROSS JOIN LATERAL aclexplode(
      COALESCE(function_row.proacl, acldefault('f', function_row.proowner))
    ) AS acl_row
    WHERE extension_row.extname = 'uuid-ossp'
      AND function_namespace.nspname = 'public'
    ORDER BY
      function_row.proname,
      pg_get_function_identity_arguments(function_row.oid),
      grantee,
      grantor,
      acl_row.privilege_type,
      acl_row.is_grantable
  `);

  return { functions, privileges };
}

export async function uuidOsspAdoptionFingerprint(
  queryRunner: QueryRunner,
): Promise<string> {
  const shape = canonicalize(await collectUuidOsspShape(queryRunner));
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
