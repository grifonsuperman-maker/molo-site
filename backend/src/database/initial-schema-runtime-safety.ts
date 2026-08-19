import { QueryRunner } from 'typeorm';

export async function assertNoGeneratedOrIdentityColumns(
  queryRunner: QueryRunner,
): Promise<void> {
  const unexpected = await queryRunner.query(`
    SELECT
      table_name,
      column_name,
      is_generated,
      generation_expression,
      is_identity,
      identity_generation
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (is_generated <> 'NEVER' OR is_identity <> 'NO')
    ORDER BY table_name, ordinal_position
  `);

  if (unexpected.length > 0) {
    const preview = unexpected
      .slice(0, 5)
      .map(
        (row: {
          table_name: string;
          column_name: string;
          is_generated: string;
          is_identity: string;
        }) =>
          `${row.table_name}.${row.column_name}:generated=${row.is_generated},identity=${row.is_identity}`,
      )
      .join(', ');
    throw new Error(
      `Existing database contains generated or identity columns outside the approved baseline: ${preview}`,
    );
  }
}

export async function assertCurrentUserOwnsAndCanUsePublicTables(
  queryRunner: QueryRunner,
): Promise<void> {
  const unsafeTables = await queryRunner.query(`
    SELECT
      relation.relname AS table_name,
      relation.relowner = current_role.oid AS owned_by_current_user,
      has_table_privilege(current_user, relation.oid, 'SELECT') AS can_select,
      has_table_privilege(current_user, relation.oid, 'INSERT') AS can_insert,
      has_table_privilege(current_user, relation.oid, 'UPDATE') AS can_update,
      has_table_privilege(current_user, relation.oid, 'DELETE') AS can_delete
    FROM pg_class AS relation
    JOIN pg_namespace AS relation_namespace
      ON relation_namespace.oid = relation.relnamespace
    CROSS JOIN LATERAL (
      SELECT oid FROM pg_roles WHERE rolname = current_user
    ) AS current_role
    WHERE relation_namespace.nspname = 'public'
      AND relation.relkind IN ('r', 'p')
      AND NOT (
        relation.relowner = current_role.oid
        AND has_table_privilege(current_user, relation.oid, 'SELECT')
        AND has_table_privilege(current_user, relation.oid, 'INSERT')
        AND has_table_privilege(current_user, relation.oid, 'UPDATE')
        AND has_table_privilege(current_user, relation.oid, 'DELETE')
      )
    ORDER BY relation.relname
  `);

  if (unsafeTables.length > 0) {
    const preview = unsafeTables
      .slice(0, 5)
      .map(
        (row: {
          table_name: string;
          owned_by_current_user: boolean;
          can_select: boolean;
          can_insert: boolean;
          can_update: boolean;
          can_delete: boolean;
        }) =>
          `${row.table_name}:owner=${row.owned_by_current_user},select=${row.can_select},insert=${row.can_insert},update=${row.can_update},delete=${row.can_delete}`,
      )
      .join(', ');
    throw new Error(
      `Current database role does not own or cannot perform required runtime operations on public tables: ${preview}`,
    );
  }

  const unsafeSequences = await queryRunner.query(`
    SELECT
      sequence_relation.relname AS sequence_name,
      sequence_relation.relowner = current_role.oid AS owned_by_current_user,
      has_sequence_privilege(current_user, sequence_relation.oid, 'USAGE') AS can_use,
      has_sequence_privilege(current_user, sequence_relation.oid, 'SELECT') AS can_select,
      has_sequence_privilege(current_user, sequence_relation.oid, 'UPDATE') AS can_update
    FROM pg_class AS sequence_relation
    JOIN pg_namespace AS sequence_namespace
      ON sequence_namespace.oid = sequence_relation.relnamespace
    CROSS JOIN LATERAL (
      SELECT oid FROM pg_roles WHERE rolname = current_user
    ) AS current_role
    WHERE sequence_namespace.nspname = 'public'
      AND sequence_relation.relkind = 'S'
      AND NOT (
        sequence_relation.relowner = current_role.oid
        AND has_sequence_privilege(current_user, sequence_relation.oid, 'USAGE')
        AND has_sequence_privilege(current_user, sequence_relation.oid, 'SELECT')
        AND has_sequence_privilege(current_user, sequence_relation.oid, 'UPDATE')
      )
    ORDER BY sequence_relation.relname
  `);

  if (unsafeSequences.length > 0) {
    const preview = unsafeSequences
      .slice(0, 5)
      .map(
        (row: {
          sequence_name: string;
          owned_by_current_user: boolean;
          can_use: boolean;
          can_select: boolean;
          can_update: boolean;
        }) =>
          `${row.sequence_name}:owner=${row.owned_by_current_user},usage=${row.can_use},select=${row.can_select},update=${row.can_update}`,
      )
      .join(', ');
    throw new Error(
      `Current database role does not own or cannot use required public sequences: ${preview}`,
    );
  }
}

export async function assertInitialSchemaAdoptionRuntimeSafety(
  queryRunner: QueryRunner,
): Promise<void> {
  await assertNoGeneratedOrIdentityColumns(queryRunner);
  await assertCurrentUserOwnsAndCanUsePublicTables(queryRunner);
}
