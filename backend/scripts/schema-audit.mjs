import pg from 'pg';
import { pathToFileURL } from 'node:url';

const { Client } = pg;

function connectionConfig() {
  if (process.env.DB_URL) {
    return {
      connectionString: process.env.DB_URL,
      ssl: { rejectUnauthorized: false },
    };
  }

  return {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_NAME || 'molo_restaurant',
  };
}

const queries = {
  server: `
    SELECT
      current_database() AS database_name,
      current_schema() AS schema_name,
      current_setting('server_version') AS server_version
  `,
  extensions: `
    SELECT extname AS name, extversion AS version
    FROM pg_extension
    ORDER BY extname
  `,
  tables: `
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `,
  columns: `
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
      datetime_precision
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position
  `,
  enums: `
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
  `,
  constraints: `
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
  `,
  indexes: `
    SELECT
      tablename AS table_name,
      indexname AS index_name,
      indexdef AS definition
    FROM pg_indexes
    WHERE schemaname = 'public'
    ORDER BY tablename, indexname
  `,
  triggers: `
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
  `,
  functions: `
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
    ORDER BY function_row.proname, pg_get_function_identity_arguments(function_row.oid)
  `,
  sequences: `
    SELECT
      sequence_name,
      data_type,
      start_value,
      minimum_value,
      maximum_value,
      increment
    FROM information_schema.sequences
    WHERE sequence_schema = 'public'
    ORDER BY sequence_name
  `,
  views: `
    SELECT table_name AS view_name, view_definition
    FROM information_schema.views
    WHERE table_schema = 'public'
    ORDER BY table_name
  `,
  migrationsTable: `
    SELECT to_regclass('public.migrations')::text AS migrations_table
  `,
  migrations: `
    SELECT id, timestamp, name
    FROM public.migrations
    ORDER BY id
  `,
};

export async function collectSchemaSnapshot(client) {
  await client.query(
    'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY',
  );

  try {
    const snapshot = {
      capturedAt: new Date().toISOString(),
      server: (await client.query(queries.server)).rows[0] || null,
      extensions: (await client.query(queries.extensions)).rows,
      tables: (await client.query(queries.tables)).rows,
      columns: (await client.query(queries.columns)).rows,
      enums: (await client.query(queries.enums)).rows,
      constraints: (await client.query(queries.constraints)).rows,
      indexes: (await client.query(queries.indexes)).rows,
      triggers: (await client.query(queries.triggers)).rows,
      functions: (await client.query(queries.functions)).rows,
      sequences: (await client.query(queries.sequences)).rows,
      views: (await client.query(queries.views)).rows,
      typeOrmMigrations: [],
    };

    const migrationTable = await client.query(queries.migrationsTable);
    if (migrationTable.rows[0]?.migrations_table) {
      snapshot.typeOrmMigrations = (await client.query(queries.migrations)).rows;
    }

    await client.query('COMMIT');
    return snapshot;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function main() {
  const client = new Client(connectionConfig());
  await client.connect();

  try {
    const snapshot = await collectSchemaSnapshot(client);
    process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(
      `Schema audit failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}
