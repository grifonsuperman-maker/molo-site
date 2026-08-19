import { MigrationInterface, QueryRunner } from 'typeorm';

import {
  INITIAL_SCHEMA_BASELINE_CREATE_STATEMENTS,
  INITIAL_SCHEMA_BASELINE_CRITICAL_INDEXES,
  INITIAL_SCHEMA_BASELINE_ENUMS,
  INITIAL_SCHEMA_BASELINE_NAME,
  INITIAL_SCHEMA_BASELINE_TABLES,
} from '../database/initial-schema-baseline-definition';
import {
  INITIAL_SCHEMA_BASELINE_DOWN_STATEMENTS,
  INITIAL_SCHEMA_BASELINE_RELATION_STATEMENTS,
} from '../database/initial-schema-baseline-relations';

async function readExistingBaselineTableNames(queryRunner: QueryRunner) {
  const rows = await queryRunner.query(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name = ANY($1::text[])
     ORDER BY table_name`,
    [[...INITIAL_SCHEMA_BASELINE_TABLES]],
  );
  return rows.map((row: { table_name: string }) => String(row.table_name));
}

async function assertExistingBaselineCompatible(queryRunner: QueryRunner) {
  const [extension] = await queryRunner.query(
    `SELECT EXISTS (
       SELECT 1 FROM pg_extension WHERE extname = 'uuid-ossp'
     ) AS present`,
  );
  if (!extension?.present) {
    throw new Error('Existing baseline is missing uuid-ossp extension');
  }

  const enumRows = await queryRunner.query(
    `SELECT typname
     FROM pg_type
     WHERE typname = ANY($1::text[])
     ORDER BY typname`,
    [[...INITIAL_SCHEMA_BASELINE_ENUMS]],
  );
  const enumNames = enumRows.map((row: { typname: string }) => String(row.typname));
  if (
    JSON.stringify(enumNames) !==
    JSON.stringify([...INITIAL_SCHEMA_BASELINE_ENUMS].sort())
  ) {
    throw new Error('Existing baseline is missing expected enum types');
  }

  const indexRows = await queryRunner.query(
    `SELECT indexname
     FROM pg_indexes
     WHERE schemaname = 'public'
       AND indexname = ANY($1::text[])
     ORDER BY indexname`,
    [[...INITIAL_SCHEMA_BASELINE_CRITICAL_INDEXES]],
  );
  const indexNames = indexRows.map((row: { indexname: string }) => String(row.indexname));
  if (
    JSON.stringify(indexNames) !==
    JSON.stringify([...INITIAL_SCHEMA_BASELINE_CRITICAL_INDEXES].sort())
  ) {
    throw new Error('Existing baseline is missing critical booking indexes');
  }
}

async function assertBaselineTablesEmpty(queryRunner: QueryRunner) {
  for (const tableName of INITIAL_SCHEMA_BASELINE_TABLES) {
    const [row] = await queryRunner.query(
      `SELECT EXISTS (SELECT 1 FROM "${tableName}" LIMIT 1) AS has_rows`,
    );
    if (row?.has_rows) {
      throw new Error(
        `Refusing to revert initial schema baseline because ${tableName} contains data`,
      );
    }
  }
}

export class InitialSchemaBaseline2026081300000 implements MigrationInterface {
  name = INITIAL_SCHEMA_BASELINE_NAME;

  public async up(queryRunner: QueryRunner): Promise<void> {
    const existingTables = await readExistingBaselineTableNames(queryRunner);

    if (existingTables.length === INITIAL_SCHEMA_BASELINE_TABLES.length) {
      await assertExistingBaselineCompatible(queryRunner);
      return;
    }

    if (existingTables.length > 0) {
      throw new Error(
        `Refusing partial initial baseline. Found ${existingTables.length} of ${INITIAL_SCHEMA_BASELINE_TABLES.length} expected tables`,
      );
    }

    for (const statement of INITIAL_SCHEMA_BASELINE_CREATE_STATEMENTS) {
      await queryRunner.query(statement);
    }
    for (const statement of INITIAL_SCHEMA_BASELINE_RELATION_STATEMENTS) {
      await queryRunner.query(statement);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const existingTables = await readExistingBaselineTableNames(queryRunner);

    if (existingTables.length === 0) {
      return;
    }

    if (existingTables.length !== INITIAL_SCHEMA_BASELINE_TABLES.length) {
      throw new Error(
        `Refusing partial initial baseline revert. Found ${existingTables.length} of ${INITIAL_SCHEMA_BASELINE_TABLES.length} expected tables`,
      );
    }

    await assertBaselineTablesEmpty(queryRunner);

    for (const statement of INITIAL_SCHEMA_BASELINE_DOWN_STATEMENTS) {
      await queryRunner.query(statement);
    }
  }
}
