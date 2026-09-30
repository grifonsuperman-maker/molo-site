import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const REQUIRED_DATABASE_NAME = 'molo_fresh_schema_reference';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

export function assertFreshSchemaReferenceTarget(env = process.env) {
  if (String(env.FRESH_SCHEMA_REFERENCE_ALLOW || '').trim() !== 'true') {
    throw new Error(
      'Fresh schema reference is disabled. Set FRESH_SCHEMA_REFERENCE_ALLOW=true only for an isolated local database.',
    );
  }

  if (String(env.DB_URL || '').trim()) {
    throw new Error(
      'Fresh schema reference refuses DB_URL. Use the explicit loopback DB_HOST configuration.',
    );
  }

  const host = String(env.DB_HOST || '').trim().toLowerCase();
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new Error(
      'Fresh schema reference requires DB_HOST to be localhost, 127.0.0.1 or ::1.',
    );
  }

  if (String(env.DB_NAME || '').trim() !== REQUIRED_DATABASE_NAME) {
    throw new Error(
      `Fresh schema reference requires DB_NAME=${REQUIRED_DATABASE_NAME}.`,
    );
  }

  if (String(env.DB_SYNCHRONIZE || '').trim().toLowerCase() !== 'true') {
    throw new Error(
      'Fresh schema reference requires DB_SYNCHRONIZE=true for the disposable local database.',
    );
  }
}

export function lockFreshSchemaReferenceEnvironment(env = process.env) {
  env.DB_URL = '';
  env.TELEGRAM_BOT_TOKEN = '';
  env.TELEGRAM_BOT_USERNAME = '';
  env.TELEGRAM_WEBHOOK_SECRET = '';
  env.RENDER_EXTERNAL_URL = '';
  env.MOLO_BOOTSTRAP_ADMIN_NAME = '';
  env.MOLO_BOOTSTRAP_ADMIN_PIN = '';
  env.NODE_ENV = 'test';
}

export async function createFreshSchemaReference(env = process.env) {
  assertFreshSchemaReferenceTarget(env);

  if (env !== process.env) {
    throw new Error(
      'Fresh schema reference application startup must use process.env after safety validation.',
    );
  }

  // Keep explicit empty values in process.env so ConfigModule cannot reintroduce
  // DB_URL, Telegram/Render credentials or bootstrap admin values from a local .env.
  lockFreshSchemaReferenceEnvironment(process.env);

  const require = createRequire(import.meta.url);
  // The legacy integration entity is now migration-owned. Provision only its
  // frozen pre-runtime baseline in this guarded disposable reference, before
  // the application runs registered feature migrations. Never adopt live history.
  const { DataSource } = require('typeorm');
  const { INITIAL_SCHEMA_BASELINE_CREATE_STATEMENTS } = require('../dist/database/initial-schema-baseline-definition.js');
  const { INITIAL_SCHEMA_BASELINE_RELATION_STATEMENTS } = require('../dist/database/initial-schema-baseline-relations.js');
  const legacy = new DataSource({ type: 'postgres', host: env.DB_HOST, port: Number(env.DB_PORT || 5432),
    username: env.DB_USER || 'postgres', password: env.DB_PASSWORD || 'postgres', database: env.DB_NAME });
  await legacy.initialize();
  try {
    await legacy.transaction(async (manager) => {
      const [state] = await manager.query("SELECT to_regclass('public.syrve_integrations') IS NOT NULL AS present");
      if (!state.present) {
        await manager.query(INITIAL_SCHEMA_BASELINE_CREATE_STATEMENTS[0]);
        await manager.query(INITIAL_SCHEMA_BASELINE_CREATE_STATEMENTS.find((sql) => sql.startsWith('CREATE TABLE "syrve_integrations"')));
        await manager.query(INITIAL_SCHEMA_BASELINE_RELATION_STATEMENTS.find((sql) => sql.startsWith('ALTER TABLE "syrve_integrations"') && sql.includes('PRIMARY KEY')));
      }
    });
  } finally { await legacy.destroy(); }

  const { NestFactory } = require('@nestjs/core');
  const { AppModule } = require('../dist/app.module.js');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });

  await app.close();
}

async function main() {
  await createFreshSchemaReference();
  process.stdout.write('Fresh local schema reference initialized successfully.\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(
      `Fresh schema reference failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}
