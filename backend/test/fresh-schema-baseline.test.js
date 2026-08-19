const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');

const {
  InitialSchemaBaseline2026081300000,
} = require('../dist/migrations/2026081300000-InitialSchemaBaseline.js');
const {
  INITIAL_SCHEMA_BASELINE_NAME,
  INITIAL_SCHEMA_BASELINE_TABLES,
} = require('../dist/database/initial-schema-baseline-definition.js');

test('fresh initial baseline keeps the exact pre-runtime MOLO table set', () => {
  assert.equal(INITIAL_SCHEMA_BASELINE_NAME, 'InitialSchemaBaseline2026081300000');
  assert.equal(INITIAL_SCHEMA_BASELINE_TABLES.length, 17);
  assert.ok(INITIAL_SCHEMA_BASELINE_TABLES.includes('bookings'));
  assert.ok(INITIAL_SCHEMA_BASELINE_TABLES.includes('tables'));
  assert.ok(!INITIAL_SCHEMA_BASELINE_TABLES.includes('waiter_calls'));
  assert.ok(!INITIAL_SCHEMA_BASELINE_TABLES.includes('staff_pin_attempts'));
});

test('fresh initial baseline is not registered in application runtime', async () => {
  const appModule = await readFile(
    path.resolve(__dirname, '../src/app.module.ts'),
    'utf8',
  );
  assert.doesNotMatch(appModule, /InitialSchemaBaseline2026081300000/);
  assert.doesNotMatch(appModule, /2026081300000-InitialSchemaBaseline/);
});

test('fresh initial baseline has no existing-schema adoption branch', async () => {
  const migrationSource = await readFile(
    path.resolve(
      __dirname,
      '../src/migrations/2026081300000-InitialSchemaBaseline.ts',
    ),
    'utf8',
  );

  assert.match(migrationSource, /refuses non-empty TypeORM migration history/);
  assert.match(migrationSource, /refuses an existing MOLO schema/);
  assert.doesNotMatch(migrationSource, /adopt/i);

  const migration = new InitialSchemaBaseline2026081300000();
  assert.equal(migration.name, INITIAL_SCHEMA_BASELINE_NAME);
});
