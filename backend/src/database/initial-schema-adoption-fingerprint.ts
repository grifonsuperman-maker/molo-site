import { createHash } from 'node:crypto';
import { QueryRunner } from 'typeorm';

export const CURRENT_SCHEMA_ADOPTION_FINGERPRINT =
  '326faee9ce433c415e3e5e18a8c864e0d41e94800b04fd62f9f1275f4ecb5982';

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

async function collectCurrentSchemaShape(queryRunner: QueryRunner) {
  const extensions = await queryRunner.query(`
    SELECT extname AS name
    FROM pg_extension
    ORDER BY extname
  `);

  const tables = await queryRunner.query(`
    SELECT
      relation.relname AS table_name,
      relation.relpersistence AS persistence,
      relation.relrowsecurity AS row_security_enabled,
      relation.relforcerowsecurity AS row_security_forced
    FROM pg_class AS relation
    JOIN pg_namespace AS relation_namespace
      ON relation_namespace.oid = relation.relnamespace
    WHERE relation_namespace.nspname = 'public'
      AND relation.relkind IN ('r', 'p')
    ORDER BY relation.relname
  `);

  const columns = await queryRunner.query(`
    SELECT
      table_name,
      column_name,
      ordinal_position,
      data_type,
      udt_name,
      is_nullable,
      column_default,
      character_maximum_length,
      numeric_precision,
      numeric_scale,
      datetime_precision,
      collation_schema,
      collation_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position
  `);

  const enums = await queryRunner.query(`
    SELECT
      type_namespace.nspname AS schema_name,
      enum_type.typname AS enum_name,
      enum_value.enumsortorder AS sort_order,
      enum_value.enumlabel AS value
    FROM pg_type AS enum_type
    JOIN pg_enum AS enum_value ON enum_value.enumtypid = enum_type.oid
    JOIN pg_namespace AS type_namespace ON type_namespace.oid = enum_type.typnamespace
    WHERE type_namespace.nspname = 'public'
    ORDER BY enum_type.typname, enum_value.enumsortorder
  `);

  const standaloneTypes = await queryRunner.query(`
    SELECT
      type_namespace.nspname AS schema_name,
      type_row.typname AS type_name,
      type_row.typtype AS type_kind,
      type_row.typcategory AS type_category,
      CASE
        WHEN type_row.typbasetype = 0 THEN NULL
        ELSE format_type(type_row.typbasetype, type_row.typtypmod)
      END AS base_type,
      type_row.typnotnull AS not_null,
      type_row.typdefault AS default_expression,
      type_relation.relkind AS relation_kind
    FROM pg_type AS type_row
    JOIN pg_namespace AS type_namespace
      ON type_namespace.oid = type_row.typnamespace
    LEFT JOIN pg_class AS type_relation
      ON type_relation.oid = type_row.typrelid
    WHERE type_namespace.nspname = 'public'
      AND type_row.typtype <> 'e'
      AND NOT (type_row.typcategory = 'A' AND type_row.typelem <> 0)
      AND (
        type_row.typrelid = 0
        OR type_relation.relkind = 'c'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM pg_depend AS dependency
        WHERE dependency.classid = 'pg_type'::regclass
          AND dependency.objid = type_row.oid
          AND dependency.refclassid = 'pg_extension'::regclass
          AND dependency.deptype = 'e'
      )
    ORDER BY type_row.typname
  `);

  const collations = await queryRunner.query(`
    SELECT
      collation_namespace.nspname AS schema_name,
      collation_row.collname AS collation_name,
      collation_row.collprovider AS provider,
      collation_row.collisdeterministic AS deterministic
    FROM pg_collation AS collation_row
    JOIN pg_namespace AS collation_namespace
      ON collation_namespace.oid = collation_row.collnamespace
    WHERE collation_namespace.nspname = 'public'
    ORDER BY collation_row.collname
  `);

  const constraints = await queryRunner.query(`
    SELECT
      relation.relname AS table_name,
      constraint_row.conname AS constraint_name,
      constraint_row.contype AS constraint_type,
      pg_get_constraintdef(constraint_row.oid, true) AS definition
    FROM pg_constraint AS constraint_row
    JOIN pg_class AS relation ON relation.oid = constraint_row.conrelid
    JOIN pg_namespace AS relation_namespace ON relation_namespace.oid = relation.relnamespace
    WHERE relation_namespace.nspname = 'public'
    ORDER BY relation.relname, constraint_row.conname
  `);

  const indexes = await queryRunner.query(`
    SELECT
      index_view.tablename AS table_name,
      index_view.indexname AS index_name,
      index_view.indexdef AS definition,
      index_relation.relpersistence AS persistence,
      index_state.indisvalid AS is_valid,
      index_state.indisready AS is_ready
    FROM pg_indexes AS index_view
    JOIN pg_namespace AS index_namespace
      ON index_namespace.nspname = index_view.schemaname
    JOIN pg_class AS index_relation
      ON index_relation.relnamespace = index_namespace.oid
      AND index_relation.relname = index_view.indexname
    JOIN pg_index AS index_state
      ON index_state.indexrelid = index_relation.oid
    WHERE index_view.schemaname = 'public'
    ORDER BY index_view.tablename, index_view.indexname
  `);

  const policies = await queryRunner.query(`
    SELECT
      relation.relname AS table_name,
      policy_row.polname AS policy_name,
      policy_row.polpermissive AS permissive,
      policy_row.polcmd AS command,
      ARRAY(
        SELECT role_name
        FROM (
          SELECT CASE
            WHEN role_oid = 0 THEN 'PUBLIC'
            ELSE pg_get_userbyid(role_oid)
          END AS role_name
          FROM unnest(policy_row.polroles) AS role_oid
        ) AS policy_roles
        ORDER BY role_name
      ) AS roles,
      pg_get_expr(policy_row.polqual, policy_row.polrelid, true) AS using_expression,
      pg_get_expr(policy_row.polwithcheck, policy_row.polrelid, true) AS check_expression
    FROM pg_policy AS policy_row
    JOIN pg_class AS relation ON relation.oid = policy_row.polrelid
    JOIN pg_namespace AS relation_namespace
      ON relation_namespace.oid = relation.relnamespace
    WHERE relation_namespace.nspname = 'public'
    ORDER BY relation.relname, policy_row.polname
  `);

  const triggers = await queryRunner.query(`
    SELECT
      relation.relname AS table_name,
      trigger_row.tgname AS trigger_name,
      trigger_row.tgenabled AS enabled_state,
      pg_get_triggerdef(trigger_row.oid, true) AS definition
    FROM pg_trigger AS trigger_row
    JOIN pg_class AS relation ON relation.oid = trigger_row.tgrelid
    JOIN pg_namespace AS relation_namespace ON relation_namespace.oid = relation.relnamespace
    WHERE relation_namespace.nspname = 'public'
      AND NOT trigger_row.tgisinternal
    ORDER BY relation.relname, trigger_row.tgname
  `);

  const internalConstraintTriggers = await queryRunner.query(`
    SELECT
      relation.relname AS table_name,
      constraint_row.conname AS constraint_name,
      constraint_row.contype AS constraint_type,
      trigger_row.tgenabled AS enabled_state,
      trigger_row.tgtype AS trigger_type,
      trigger_function.proname AS trigger_function,
      constraint_relation.relname AS constraint_relation_name
    FROM pg_trigger AS trigger_row
    JOIN pg_class AS relation
      ON relation.oid = trigger_row.tgrelid
    JOIN pg_namespace AS relation_namespace
      ON relation_namespace.oid = relation.relnamespace
    JOIN pg_constraint AS constraint_row
      ON constraint_row.oid = trigger_row.tgconstraint
    JOIN pg_proc AS trigger_function
      ON trigger_function.oid = trigger_row.tgfoid
    LEFT JOIN pg_class AS constraint_relation
      ON constraint_relation.oid = trigger_row.tgconstrrelid
    WHERE relation_namespace.nspname = 'public'
      AND trigger_row.tgisinternal
      AND trigger_row.tgconstraint <> 0
    ORDER BY
      relation.relname,
      constraint_row.conname,
      trigger_function.proname,
      trigger_row.tgtype,
      constraint_relation.relname
  `);

  const tableRules = await queryRunner.query(`
    SELECT
      relation.relname AS table_name,
      rewrite_rule.rulename AS rule_name,
      rewrite_rule.ev_type AS event_type,
      rewrite_rule.is_instead AS is_instead,
      rewrite_rule.ev_enabled AS enabled_state,
      pg_get_ruledef(rewrite_rule.oid, true) AS definition
    FROM pg_rewrite AS rewrite_rule
    JOIN pg_class AS relation
      ON relation.oid = rewrite_rule.ev_class
    JOIN pg_namespace AS relation_namespace
      ON relation_namespace.oid = relation.relnamespace
    WHERE relation_namespace.nspname = 'public'
      AND relation.relkind IN ('r', 'p')
    ORDER BY relation.relname, rewrite_rule.rulename
  `);

  const functions = await queryRunner.query(`
    SELECT
      function_namespace.nspname AS schema_name,
      function_row.proname AS function_name,
      pg_get_function_identity_arguments(function_row.oid) AS identity_arguments,
      function_row.prokind AS function_kind,
      pg_get_functiondef(function_row.oid) AS definition
    FROM pg_proc AS function_row
    JOIN pg_namespace AS function_namespace ON function_namespace.oid = function_row.pronamespace
    WHERE function_namespace.nspname = 'public'
      AND function_row.prokind IN ('f', 'p')
      AND NOT EXISTS (
        SELECT 1
        FROM pg_depend AS dependency
        WHERE dependency.classid = 'pg_proc'::regclass
          AND dependency.objid = function_row.oid
          AND dependency.refclassid = 'pg_extension'::regclass
          AND dependency.deptype = 'e'
      )
    ORDER BY function_row.proname, pg_get_function_identity_arguments(function_row.oid)
  `);

  const aggregates = await queryRunner.query(`
    SELECT
      aggregate_namespace.nspname AS schema_name,
      aggregate_proc.proname AS aggregate_name,
      pg_get_function_identity_arguments(aggregate_proc.oid) AS identity_arguments,
      pg_get_function_result(aggregate_proc.oid) AS result_type,
      aggregate_row.aggkind AS aggregate_kind,
      aggregate_row.aggnumdirectargs AS direct_argument_count,
      aggregate_row.aggtransfn::regprocedure::text AS transition_function,
      aggregate_row.aggfinalfn::regprocedure::text AS final_function,
      aggregate_row.aggcombinefn::regprocedure::text AS combine_function,
      aggregate_row.aggserialfn::regprocedure::text AS serial_function,
      aggregate_row.aggdeserialfn::regprocedure::text AS deserial_function,
      format_type(aggregate_row.aggtranstype, NULL) AS transition_type,
      aggregate_row.agginitval AS initial_value,
      aggregate_proc.proparallel AS parallel_safety
    FROM pg_proc AS aggregate_proc
    JOIN pg_namespace AS aggregate_namespace
      ON aggregate_namespace.oid = aggregate_proc.pronamespace
    JOIN pg_aggregate AS aggregate_row
      ON aggregate_row.aggfnoid = aggregate_proc.oid
    WHERE aggregate_namespace.nspname = 'public'
      AND aggregate_proc.prokind = 'a'
      AND NOT EXISTS (
        SELECT 1
        FROM pg_depend AS dependency
        WHERE dependency.classid = 'pg_proc'::regclass
          AND dependency.objid = aggregate_proc.oid
          AND dependency.refclassid = 'pg_extension'::regclass
          AND dependency.deptype = 'e'
      )
    ORDER BY aggregate_proc.proname, pg_get_function_identity_arguments(aggregate_proc.oid)
  `);

  const sequences = await queryRunner.query(`
    SELECT
      sequence_namespace.nspname AS schema_name,
      sequence_relation.relname AS sequence_name,
      format_type(sequence_data.seqtypid, NULL) AS data_type,
      sequence_data.seqstart AS start_value,
      sequence_data.seqmin AS minimum_value,
      sequence_data.seqmax AS maximum_value,
      sequence_data.seqincrement AS increment,
      sequence_data.seqcycle AS cycle,
      sequence_data.seqcache AS cache_size,
      owner_namespace.nspname AS owned_by_schema,
      owner_relation.relname AS owned_by_table,
      owner_attribute.attname AS owned_by_column,
      ownership.deptype AS ownership_dependency_type
    FROM pg_class AS sequence_relation
    JOIN pg_namespace AS sequence_namespace
      ON sequence_namespace.oid = sequence_relation.relnamespace
    JOIN pg_sequence AS sequence_data
      ON sequence_data.seqrelid = sequence_relation.oid
    LEFT JOIN LATERAL (
      SELECT
        dependency.refobjid,
        dependency.refobjsubid,
        dependency.deptype
      FROM pg_depend AS dependency
      WHERE dependency.classid = 'pg_class'::regclass
        AND dependency.objid = sequence_relation.oid
        AND dependency.objsubid = 0
        AND dependency.refclassid = 'pg_class'::regclass
        AND dependency.deptype IN ('a', 'i')
      ORDER BY dependency.deptype
      LIMIT 1
    ) AS ownership ON true
    LEFT JOIN pg_class AS owner_relation
      ON owner_relation.oid = ownership.refobjid
    LEFT JOIN pg_namespace AS owner_namespace
      ON owner_namespace.oid = owner_relation.relnamespace
    LEFT JOIN pg_attribute AS owner_attribute
      ON owner_attribute.attrelid = owner_relation.oid
      AND owner_attribute.attnum = ownership.refobjsubid
      AND NOT owner_attribute.attisdropped
    WHERE sequence_namespace.nspname = 'public'
      AND sequence_relation.relkind = 'S'
    ORDER BY sequence_relation.relname
  `);

  const views = await queryRunner.query(`
    SELECT table_name AS view_name, view_definition
    FROM information_schema.views
    WHERE table_schema = 'public'
    ORDER BY table_name
  `);

  const materializedViews = await queryRunner.query(`
    SELECT
      matviewname AS view_name,
      tablespace,
      hasindexes AS has_indexes,
      ispopulated AS is_populated,
      definition
    FROM pg_matviews
    WHERE schemaname = 'public'
    ORDER BY matviewname
  `);

  return {
    extensions,
    tables,
    columns,
    enums,
    standaloneTypes,
    collations,
    constraints,
    indexes,
    policies,
    triggers,
    internalConstraintTriggers,
    tableRules,
    functions,
    aggregates,
    sequences,
    views,
    materializedViews,
  };
}

export async function currentSchemaAdoptionFingerprint(
  queryRunner: QueryRunner,
): Promise<string> {
  const shape = canonicalize(await collectCurrentSchemaShape(queryRunner));
  return createHash('sha256').update(JSON.stringify(shape)).digest('hex');
}

export async function assertCurrentSchemaMatchesAdoptionReference(
  queryRunner: QueryRunner,
): Promise<void> {
  const actual = await currentSchemaAdoptionFingerprint(queryRunner);
  if (actual !== CURRENT_SCHEMA_ADOPTION_FINGERPRINT) {
    throw new Error(
      `Existing database schema does not match the approved current-schema adoption reference (${actual})`,
    );
  }
}

async function assertTypeOrmMigrationHistoryEmpty(queryRunner: QueryRunner) {
  const [relation] = await queryRunner.query(`
    SELECT to_regclass('public.migrations') IS NOT NULL AS exists
  `);
  if (!relation?.exists) {
    return;
  }

  const [history] = await queryRunner.query(`
    SELECT COUNT(*)::int AS count
    FROM public.migrations
  `);
  if (Number(history?.count) !== 0) {
    throw new Error(
      `Refusing initial baseline because TypeORM migration history is not empty (${history?.count} row(s))`,
    );
  }
}

export async function assertDatabaseIsFreshForInitialBaseline(
  queryRunner: QueryRunner,
): Promise<void> {
  await assertTypeOrmMigrationHistoryEmpty(queryRunner);

  const unexpected = await queryRunner.query(`
    SELECT object_kind, object_name
    FROM (
      SELECT
        'relation'::text AS object_kind,
        relation_namespace.nspname || '.' || relation.relname AS object_name
      FROM pg_class AS relation
      JOIN pg_namespace AS relation_namespace ON relation_namespace.oid = relation.relnamespace
      WHERE relation_namespace.nspname = 'public'
        AND relation.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
        AND NOT (
          (relation.relkind IN ('r', 'p') AND relation.relname = 'migrations')
          OR (relation.relkind = 'S' AND relation.relname = 'migrations_id_seq')
        )

      UNION ALL

      SELECT
        'type'::text,
        type_namespace.nspname || '.' || type_row.typname
      FROM pg_type AS type_row
      JOIN pg_namespace AS type_namespace ON type_namespace.oid = type_row.typnamespace
      WHERE type_namespace.nspname = 'public'
        AND type_row.typname NOT IN ('migrations', '_migrations')

      UNION ALL

      SELECT
        'function'::text,
        function_namespace.nspname || '.' || function_row.proname || '(' ||
          pg_get_function_identity_arguments(function_row.oid) || ')'
      FROM pg_proc AS function_row
      JOIN pg_namespace AS function_namespace ON function_namespace.oid = function_row.pronamespace
      WHERE function_namespace.nspname = 'public'
        AND function_row.prokind IN ('f', 'p')

      UNION ALL

      SELECT
        'aggregate'::text,
        aggregate_namespace.nspname || '.' || aggregate_proc.proname || '(' ||
          pg_get_function_identity_arguments(aggregate_proc.oid) || ')'
      FROM pg_proc AS aggregate_proc
      JOIN pg_namespace AS aggregate_namespace
        ON aggregate_namespace.oid = aggregate_proc.pronamespace
      WHERE aggregate_namespace.nspname = 'public'
        AND aggregate_proc.prokind = 'a'

      UNION ALL

      SELECT
        'collation'::text,
        collation_namespace.nspname || '.' || collation_row.collname
      FROM pg_collation AS collation_row
      JOIN pg_namespace AS collation_namespace
        ON collation_namespace.oid = collation_row.collnamespace
      WHERE collation_namespace.nspname = 'public'

      UNION ALL

      SELECT
        'extension'::text,
        extension_row.extname
      FROM pg_extension AS extension_row
      WHERE extension_row.extname <> 'plpgsql'

      UNION ALL

      SELECT
        'schema'::text,
        schema_row.nspname
      FROM pg_namespace AS schema_row
      WHERE schema_row.nspname NOT IN ('public', 'information_schema')
        AND schema_row.nspname NOT LIKE 'pg_%'
    ) AS unexpected_objects
    ORDER BY object_kind, object_name
  `);

  if (unexpected.length > 0) {
    const preview = unexpected
      .slice(0, 5)
      .map(
        (row: { object_kind: string; object_name: string }) =>
          `${row.object_kind}:${row.object_name}`,
      )
      .join(', ');
    throw new Error(
      `Refusing initial baseline on non-empty database. Unexpected objects: ${preview}`,
    );
  }
}
