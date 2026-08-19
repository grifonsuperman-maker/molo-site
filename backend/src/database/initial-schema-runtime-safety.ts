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

export async function assertCurrentUserCanUsePublicTables(
  queryRunner: QueryRunner,
): Promise<void> {
  const unsafeTables = await queryRunner.query(`
    SELECT
      relation.relname AS table_name,
      has_table_privilege(current_user, relation.oid, 'SELECT') AS can_select,
      has_table_privilege(current_user, relation.oid, 'INSERT') AS can_insert,
      has_table_privilege(current_user, relation.oid, 'UPDATE') AS can_update,
      has_table_privilege(current_user, relation.oid, 'DELETE') AS can_delete
    FROM pg_class AS relation
    JOIN pg_namespace AS relation_namespace
      ON relation_namespace.oid = relation.relnamespace
    WHERE relation_namespace.nspname = 'public'
      AND relation.relkind IN ('r', 'p')
      AND NOT (
        has_table_privilege(current_user, relation.oid, 'SELECT')
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
          can_select: boolean;
          can_insert: boolean;
          can_update: boolean;
          can_delete: boolean;
        }) =>
          `${row.table_name}:select=${row.can_select},insert=${row.can_insert},update=${row.can_update},delete=${row.can_delete}`,
      )
      .join(', ');
    throw new Error(
      `Current database role cannot perform required runtime operations on public tables: ${preview}`,
    );
  }

  const unsafeSequences = await queryRunner.query(`
    SELECT
      sequence_relation.relname AS sequence_name,
      has_sequence_privilege(current_user, sequence_relation.oid, 'USAGE') AS can_use,
      has_sequence_privilege(current_user, sequence_relation.oid, 'SELECT') AS can_select,
      has_sequence_privilege(current_user, sequence_relation.oid, 'UPDATE') AS can_update
    FROM pg_class AS sequence_relation
    JOIN pg_namespace AS sequence_namespace
      ON sequence_namespace.oid = sequence_relation.relnamespace
    WHERE sequence_namespace.nspname = 'public'
      AND sequence_relation.relkind = 'S'
      AND NOT (
        has_sequence_privilege(current_user, sequence_relation.oid, 'USAGE')
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
          can_use: boolean;
          can_select: boolean;
          can_update: boolean;
        }) =>
          `${row.sequence_name}:usage=${row.can_use},select=${row.can_select},update=${row.can_update}`,
      )
      .join(', ');
    throw new Error(
      `Current database role cannot use required public sequences: ${preview}`,
    );
  }
}

export async function assertInitialSchemaAdoptionRuntimeSafety(
  queryRunner: QueryRunner,
): Promise<void> {
  await assertNoGeneratedOrIdentityColumns(queryRunner);
  await assertCurrentUserCanUsePublicTables(queryRunner);
}
