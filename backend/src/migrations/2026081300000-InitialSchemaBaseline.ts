import { MigrationInterface, QueryRunner } from 'typeorm';

import {
  INITIAL_SCHEMA_BASELINE_CREATE_STATEMENTS,
  INITIAL_SCHEMA_BASELINE_NAME,
  INITIAL_SCHEMA_BASELINE_TABLES,
} from '../database/initial-schema-baseline-definition';
import {
  INITIAL_SCHEMA_BASELINE_DOWN_STATEMENTS,
  INITIAL_SCHEMA_BASELINE_RELATION_STATEMENTS,
} from '../database/initial-schema-baseline-relations';

async function readMigrationHistory(queryRunner: QueryRunner) {
  const [tableRow] = await queryRunner.query(
    `SELECT to_regclass('public.migrations')::text AS migrations_table`,
  );
  if (!tableRow?.migrations_table) return [];

  const rows = await queryRunner.query(
    `SELECT "name" FROM "migrations" ORDER BY "id" ASC`,
  );
  return rows.map((row: { name: string }) => String(row.name));
}

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

async function assertFreshBaselineTarget(queryRunner: QueryRunner) {
  const migrationHistory = await readMigrationHistory(queryRunner);
  if (migrationHistory.length > 0) {
    throw new Error(
      `Fresh schema baseline refuses non-empty TypeORM migration history: ${JSON.stringify(migrationHistory)}`,
    );
  }

  const existingTables = await readExistingBaselineTableNames(queryRunner);
  if (existingTables.length > 0) {
    throw new Error(
      `Fresh schema baseline refuses an existing MOLO schema. Found: ${existingTables.join(', ')}`,
    );
  }

  const [extensionRow] = await queryRunner.query(`
    SELECT EXISTS (
      SELECT 1 FROM pg_extension WHERE extname = 'uuid-ossp'
    ) AS present
  `);
  if (extensionRow?.present) {
    throw new Error(
      'Fresh schema baseline requires uuid-ossp to be absent before bootstrap so down() owns its cleanup.',
    );
  }
}

async function lockBaselineTablesAgainstWrites(queryRunner: QueryRunner) {
  const tableList = INITIAL_SCHEMA_BASELINE_TABLES.map(
    (tableName) => `"${tableName}"`,
  ).join(', ');
  await queryRunner.query(
    `LOCK TABLE ${tableList} IN SHARE ROW EXCLUSIVE MODE`,
  );
}

async function assertBaselineTablesEmpty(queryRunner: QueryRunner) {
  for (const tableName of INITIAL_SCHEMA_BASELINE_TABLES) {
    const [row] = await queryRunner.query(
      `SELECT EXISTS (SELECT 1 FROM "${tableName}" LIMIT 1) AS has_rows`,
    );
    if (row?.has_rows) {
      throw new Error(
        `Refusing to revert fresh schema baseline because ${tableName} contains data`,
      );
    }
  }
}

async function runAtomicallyIfNeeded(
  queryRunner: QueryRunner,
  action: () => Promise<void>,
) {
  const ownsTransaction = !queryRunner.isTransactionActive;
  if (ownsTransaction) await queryRunner.startTransaction();

  try {
    await action();
    if (ownsTransaction) await queryRunner.commitTransaction();
  } catch (error) {
    if (ownsTransaction && queryRunner.isTransactionActive) {
      await queryRunner.rollbackTransaction();
    }
    throw error;
  }
}

export class InitialSchemaBaseline2026081300000 implements MigrationInterface {
  name = INITIAL_SCHEMA_BASELINE_NAME;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await runAtomicallyIfNeeded(queryRunner, async () => {
      await assertFreshBaselineTarget(queryRunner);

      for (const statement of INITIAL_SCHEMA_BASELINE_CREATE_STATEMENTS) {
        await queryRunner.query(statement);
      }
      for (const statement of INITIAL_SCHEMA_BASELINE_RELATION_STATEMENTS) {
        await queryRunner.query(statement);
      }
    });
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await runAtomicallyIfNeeded(queryRunner, async () => {
      const migrationHistory = await readMigrationHistory(queryRunner);
      if (
        migrationHistory.length !== 1 ||
        migrationHistory[0] !== INITIAL_SCHEMA_BASELINE_NAME
      ) {
        throw new Error(
          `Refusing fresh schema baseline revert with unexpected migration history: ${JSON.stringify(migrationHistory)}`,
        );
      }

      const existingTables = await readExistingBaselineTableNames(queryRunner);
      if (existingTables.length !== INITIAL_SCHEMA_BASELINE_TABLES.length) {
        throw new Error(
          `Refusing partial fresh schema baseline revert. Found ${existingTables.length} of ${INITIAL_SCHEMA_BASELINE_TABLES.length} expected tables`,
        );
      }

      await lockBaselineTablesAgainstWrites(queryRunner);
      await assertBaselineTablesEmpty(queryRunner);

      for (const statement of INITIAL_SCHEMA_BASELINE_DOWN_STATEMENTS) {
        await queryRunner.query(statement);
      }
    });
  }
}
