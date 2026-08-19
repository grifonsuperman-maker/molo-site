import { QueryRunner } from 'typeorm';

export async function assertNoPublicOperators(
  queryRunner: QueryRunner,
): Promise<void> {
  const operators = await queryRunner.query(`
    SELECT
      operator_namespace.nspname AS schema_name,
      operator_row.oprname AS operator_name,
      format_type(operator_row.oprleft, NULL) AS left_type,
      format_type(operator_row.oprright, NULL) AS right_type,
      format_type(operator_row.oprresult, NULL) AS result_type,
      operator_row.oprkind AS operator_kind,
      operator_row.oprcanmerge AS can_merge,
      operator_row.oprcanhash AS can_hash,
      operator_row.oprcode::regprocedure::text AS implementation
    FROM pg_operator AS operator_row
    JOIN pg_namespace AS operator_namespace
      ON operator_namespace.oid = operator_row.oprnamespace
    WHERE operator_namespace.nspname = 'public'
    ORDER BY
      operator_row.oprname,
      format_type(operator_row.oprleft, NULL),
      format_type(operator_row.oprright, NULL)
  `);

  if (operators.length > 0) {
    const preview = operators
      .slice(0, 5)
      .map(
        (row: {
          operator_name: string;
          left_type: string;
          right_type: string;
        }) => `${row.operator_name}(${row.left_type},${row.right_type})`,
      )
      .join(', ');
    throw new Error(
      `Database contains public operators outside the approved initial baseline: ${preview}`,
    );
  }
}
