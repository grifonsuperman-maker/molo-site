const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');

const {
  resolveDatabaseSynchronize,
} = require('../dist/database/database-synchronize.js');

test('database synchronize stays enabled only when DB_SYNCHRONIZE is unset', () => {
  assert.equal(resolveDatabaseSynchronize(undefined), true);
});

test('database synchronize can be explicitly disabled for an isolated database', () => {
  assert.equal(resolveDatabaseSynchronize('false'), false);
  assert.equal(resolveDatabaseSynchronize(' FALSE '), false);
});

test('database synchronize can be explicitly enabled', () => {
  assert.equal(resolveDatabaseSynchronize('true'), true);
  assert.equal(resolveDatabaseSynchronize(' TRUE '), true);
});

test('database synchronize rejects empty and ambiguous configured values', () => {
  for (const value of ['', '   ', '0', 'off']) {
    assert.throws(
      () => resolveDatabaseSynchronize(value),
      /DB_SYNCHRONIZE must be "true" or "false"/,
    );
  }
});

test('TypeORM resolves DB_SYNCHRONIZE through ConfigService after config loading', async () => {
  const appModule = await readFile(
    path.resolve(__dirname, '../src/app.module.ts'),
    'utf8',
  );

  assert.ok(
    appModule.indexOf('ConfigModule.forRoot') <
      appModule.indexOf('TypeOrmModule.forRootAsync'),
  );
  assert.match(appModule, /TypeOrmModule\.forRootAsync\(\{/);
  assert.match(
    appModule,
    /configService\.get<string>\('DB_SYNCHRONIZE'\)/,
  );
  assert.doesNotMatch(appModule, /process\.env\.DB_SYNCHRONIZE/);

  const synchronizeUsages = appModule.match(
    /synchronize:\s*databaseSynchronize/g,
  );
  assert.equal(synchronizeUsages?.length, 2);
  assert.doesNotMatch(appModule, /synchronize:\s*false/);
});
