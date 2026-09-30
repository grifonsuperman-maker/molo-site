import { MigrationInterface, QueryRunner } from 'typeorm';

// Versioned, frozen definition: runtime readiness must match the migration's body.
export const CANONICAL_TABLE_NUMBER_SQL_V1 = `
      SELECT CASE WHEN number ~ '^[0-9]{1,12}$' AND ltrim(number, '0') <> ''
        THEN ltrim(number, '0') ELSE NULL END
      FROM (SELECT btrim($1, chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32)
        || chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) || chr(8195)
        || chr(8196) || chr(8197) || chr(8198) || chr(8199) || chr(8200) || chr(8201)
        || chr(8202) || chr(8232) || chr(8233) || chr(8239) || chr(8287) || chr(12288)
        || chr(65279)) AS number) normalized
      `;

// Frozen normalization, matching canonicalTableNumber including JS trim whitespace.
// This migration never repairs duplicates or rewrites existing physical records.
export class ProtectCanonicalTableNumbers2026093000040 implements MigrationInterface {
  name = 'ProtectCanonicalTableNumbers2026093000040';

  private schema(runner: QueryRunner) {
    const options = runner.connection?.options;
    const name = options?.type === 'postgres' ? options.schema || 'public' : 'public';
    return '"' + name.replace(/"/g, '""') + '"';
  }

  async up(runner: QueryRunner): Promise<void> {
    if (!runner.isTransactionActive) throw new Error('Table number protection requires an active transaction');
    const schema = this.schema(runner);
    await runner.query("SET LOCAL lock_timeout = '750ms'");
    await runner.query(`LOCK TABLE ${schema}."tables" IN SHARE ROW EXCLUSIVE MODE`);
    await runner.query(`CREATE FUNCTION ${schema}.molo_canonical_table_number(text) RETURNS text
      LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$${CANONICAL_TABLE_NUMBER_SQL_V1}$$`);
    const [state] = await runner.query(`SELECT EXISTS (
      SELECT ${schema}.molo_canonical_table_number("table_number") FROM ${schema}."tables"
      WHERE ${schema}.molo_canonical_table_number("table_number") IS NOT NULL
      GROUP BY ${schema}.molo_canonical_table_number("table_number") HAVING count(*) > 1
    ) AS "hasDuplicates"`);
    if (state.hasDuplicates) {
      throw new Error('Duplicate canonical table numbers require audited reconciliation; no tables were changed');
    }
    await runner.query(`CREATE UNIQUE INDEX "UQ_tables_canonical_number" ON ${schema}."tables"
      (${schema}.molo_canonical_table_number("table_number"))`);
  }

  async down(runner: QueryRunner): Promise<void> {
    if (!runner.isTransactionActive) throw new Error('Table number protection rollback requires an active transaction');
    const schema = this.schema(runner);
    await runner.query("SET LOCAL lock_timeout = '750ms'");
    await runner.query(`LOCK TABLE ${schema}."tables" IN SHARE ROW EXCLUSIVE MODE`);
    // Keep all table numbers, UUID bindings, bookings and link state. A missing
    // index disables the rename service before any write; no implicit data undo.
    await runner.query(`DROP INDEX ${schema}."UQ_tables_canonical_number"`);
    await runner.query(`DROP FUNCTION ${schema}.molo_canonical_table_number(text)`);
  }
}
