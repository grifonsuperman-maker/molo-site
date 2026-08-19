import { QueryRunner } from 'typeorm';

export async function assertNoPublicOperatorCatalogObjects(
  queryRunner: QueryRunner,
): Promise<void> {
  const unexpected = await queryRunner.query(`
    SELECT object_kind, object_name
    FROM (
      SELECT
        'operator'::text AS object_kind,
        operator_namespace.nspname || '.' || operator_row.oprname || '(' ||
          format_type(operator_row.oprleft, NULL) || ',' ||
          format_type(operator_row.oprright, NULL) || ') -> ' ||
          format_type(operator_row.oprresult, NULL) || ' via ' ||
          operator_row.oprcode::regprocedure::text AS object_name
      FROM pg_operator AS operator_row
      JOIN pg_namespace AS operator_namespace
        ON operator_namespace.oid = operator_row.oprnamespace
      WHERE operator_namespace.nspname = 'public'

      UNION ALL

      SELECT
        'operator_family'::text,
        family_namespace.nspname || '.' || family_row.opfname ||
          ' USING ' || access_method.amname
      FROM pg_opfamily AS family_row
      JOIN pg_namespace AS family_namespace
        ON family_namespace.oid = family_row.opfnamespace
      JOIN pg_am AS access_method
        ON access_method.oid = family_row.opfmethod
      WHERE family_namespace.nspname = 'public'

      UNION ALL

      SELECT
        'operator_class'::text,
        class_namespace.nspname || '.' || class_row.opcname ||
          ' FOR ' || format_type(class_row.opcintype, NULL) ||
          ' USING ' || access_method.amname ||
          ' FAMILY ' || family_namespace.nspname || '.' || family_row.opfname
      FROM pg_opclass AS class_row
      JOIN pg_namespace AS class_namespace
        ON class_namespace.oid = class_row.opcnamespace
      JOIN pg_am AS access_method
        ON access_method.oid = class_row.opcmethod
      JOIN pg_opfamily AS family_row
        ON family_row.oid = class_row.opcfamily
      JOIN pg_namespace AS family_namespace
        ON family_namespace.oid = family_row.opfnamespace
      WHERE class_namespace.nspname = 'public'
    ) AS unexpected_operator_objects
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
      `Database contains public operator catalog objects outside the approved initial baseline: ${preview}`,
    );
  }
}
