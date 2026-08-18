const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');

const {
  resolveDatabaseSynchronize,
} = require('../dist/database/database-synchronize.js');

test('database synchronize stays enabled when DB_SYNCHRONIZE is unset', () => {
  assert.equal(resolveDatabaseSynchronize(undefined), true);
  assert.equal(resolveDatabaseSynchronize(''), true);
  assert.equal(resolveDatabaseSynchronize('   '), true);
});

test('database synchronize can be explicitly disabled for an isolated database', () => {
  assert.equal(resolveDatabaseSynchronize('false'), false);
  assert.equal(resolveDatabaseSynchronize(' FALSE '), false);
});

test('database synchronize can be explicitly enabled', () => {
  assert.equal(resolveDatabaseSynchronize('true'), true);
  assert.equal(resolveDatabaseSynchronize(' TRUE '), true);
});

test('database synchronize rejects ambiguous values', () => {
  assert.throws(
    () => resolveDatabaseSynchronize('0'),
    /DB_SYNCHRONIZE must be "true" or "false"/,
  );
  assert.throws(
    () => resolveDatabaseSynchronize('off'),
    /DB_SYNCHRONIZE must be "true" or "false"/,
  );
});

test('both TypeORM connection shapes use the same synchronize switch', async () => {
  const appModule = await readFile(
    path.resolve(__dirname, '../src/app.module.ts'),
    'utf8',
  );

  assert.match(
    appModule,
    /resolveDatabaseSynchronize\(\s*process\.env\.DB_SYNCHRONIZE,?\s*\)/,
  );

  const synchronizeUsages = appModule.match(
    /synchronize:\s*databaseSynchronize/g,
  );
  assert.equal(synchronizeUsages?.length, 2);
  assert.doesNotMatch(appModule, /synchronize:\s*false/);
});
