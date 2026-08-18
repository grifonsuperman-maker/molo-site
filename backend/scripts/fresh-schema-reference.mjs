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

function disableExternalIntegrations(env = process.env) {
  delete env.TELEGRAM_BOT_TOKEN;
  delete env.TELEGRAM_BOT_USERNAME;
  delete env.TELEGRAM_WEBHOOK_SECRET;
  delete env.RENDER_EXTERNAL_URL;
  delete env.MOLO_BOOTSTRAP_ADMIN_NAME;
  delete env.MOLO_BOOTSTRAP_ADMIN_PIN;
}

export async function createFreshSchemaReference(env = process.env) {
  assertFreshSchemaReferenceTarget(env);

  if (env !== process.env) {
    throw new Error(
      'Fresh schema reference application startup must use process.env after safety validation.',
    );
  }

  disableExternalIntegrations(process.env);
  process.env.NODE_ENV = 'test';

  const require = createRequire(import.meta.url);
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
