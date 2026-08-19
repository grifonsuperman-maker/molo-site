import { MigrationInterface, QueryRunner } from 'typeorm';

import {
  assertCurrentSchemaMatchesAdoptionReference,
  assertDatabaseIsFreshForInitialBaseline,
} from '../database/initial-schema-adoption-fingerprint';
import {
  INITIAL_SCHEMA_BASELINE_CREATE_STATEMENTS,
  INITIAL_SCHEMA_BASELINE_NAME,
  INITIAL_SCHEMA_BASELINE_TABLES,
} from '../database/initial-schema-baseline-definition';
import {
  INITIAL_SCHEMA_BASELINE_ADOPTED_HISTORY,
  INITIAL_SCHEMA_BASELINE_ADOPTION_RUNTIME_MIGRATIONS,
  INITIAL_SCHEMA_BASELINE_FRESH_REVERT_HISTORY,
} from '../database/initial-schema-baseline-history';
import {
  INITIAL_SCHEMA_BASELINE_DOWN_STATEMENTS,
  INITIAL_SCHEMA_BASELINE_RELATION_STATEMENTS,
} from '../database/initial-schema-baseline-relations';
import { assertInitialSchemaAdoptionRuntimeSafety } from '../database/initial-schema-runtime-safety';
import { assertUuidOsspMatchesAdoptionReference } from '../database/uuid-ossp-adoption-fingerprint';

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

async function readMigrationHistory(queryRunner: QueryRunner) {
  const rows = await queryRunner.query(
    `SELECT "name" FROM "migrations" ORDER BY "id" ASC`,
  );
  return rows.map((row: { name: string }) => String(row.name));
}

function assertMigrationHistory(
  actualNames: string[],
  expectedNames: readonly string[],
  label: string,
) {
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
    throw new Error(
      `Unexpected ${label}. Expected ${JSON.stringify(expectedNames)}, received ${JSON.stringify(actualNames)}`,
    );
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

async function lockBaselineTablesAgainstWrites(queryRunner: QueryRunner) {
  const tableList = INITIAL_SCHEMA_BASELINE_TABLES.map(
    (tableName) => `"${tableName}"`,
  ).join(', ');
  await queryRunner.query(
    `LOCK TABLE ${tableList} IN SHARE ROW EXCLUSIVE MODE`,
  );
}

async function runAtomicallyIfNeeded(
  queryRunner: QueryRunner,
  action: () => Promise<void>,
) {
  const ownsTransaction = !queryRunner.isTransactionActive;
  if (ownsTransaction) {
    await queryRunner.startTransaction();
  }

  try {
    await action();
    if (ownsTransaction) {
      await queryRunner.commitTransaction();
    }
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
      const existingTables = await readExistingBaselineTableNames(queryRunner);

      if (existingTables.length === INITIAL_SCHEMA_BASELINE_TABLES.length) {
        const migrationHistory = await readMigrationHistory(queryRunner);
        assertMigrationHistory(
          migrationHistory,
          INITIAL_SCHEMA_BASELINE_ADOPTION_RUNTIME_MIGRATIONS,
          'migration history before baseline adoption',
        );
        await assertInitialSchemaAdoptionRuntimeSafety(queryRunner);
        await assertCurrentSchemaMatchesAdoptionReference(queryRunner);
        await assertUuidOsspMatchesAdoptionReference(queryRunner);
        return;
      }

      if (existingTables.length > 0) {
        throw new Error(
          `Refusing partial initial baseline. Found ${existingTables.length} of ${INITIAL_SCHEMA_BASELINE_TABLES.length} expected tables`,
        );
      }

      await assertDatabaseIsFreshForInitialBaseline(queryRunner);

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
        JSON.stringify(migrationHistory) ===
        JSON.stringify(INITIAL_SCHEMA_BASELINE_ADOPTED_HISTORY)
      ) {
        return;
      }

      assertMigrationHistory(
        migrationHistory,
        INITIAL_SCHEMA_BASELINE_FRESH_REVERT_HISTORY,
        'migration history before fresh baseline revert',
      );

      const existingTables = await readExistingBaselineTableNames(queryRunner);
      if (existingTables.length !== INITIAL_SCHEMA_BASELINE_TABLES.length) {
        throw new Error(
          `Refusing partial initial baseline revert. Found ${existingTables.length} of ${INITIAL_SCHEMA_BASELINE_TABLES.length} expected tables`,
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
