const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

const source = fs.readFileSync(
  path.join(__dirname, '../src/migrations/2026101200010-AddRestaurantAutoTheme.ts'),
  'utf8',
);
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const moduleShim = { exports: {} };
new Function('module', 'exports', output)(moduleShim, moduleShim.exports);
const Migration = moduleShim.exports.AddRestaurantAutoTheme2026101200010;

test('auto-theme migration adds a disabled boolean flag and audits its schema', async () => {
  const statements = [];
  const runner = { query: async (sql) => {
    statements.push(sql);
    return sql.includes('information_schema.columns')
      ? [{ data_type: 'boolean', is_nullable: 'NO', column_default: 'false' }]
      : [];
  } };
  await new Migration().up(runner);
  assert.match(statements[0], /ADD COLUMN IF NOT EXISTS "auto_theme_enabled" boolean NOT NULL DEFAULT false/);
  assert.match(statements[1], /information_schema.columns/);
});

test('auto-theme migration rejects an incompatible preexisting column', async () => {
  const runner = { query: async (sql) =>
    sql.includes('information_schema.columns')
      ? [{ data_type: 'text', is_nullable: 'YES', column_default: null }]
      : [],
  };
  await assert.rejects(new Migration().up(runner), /unexpected schema/);
});

test('auto-theme migration refuses rollback while automation is enabled', async () => {
  const statements = [];
  const runner = { query: async (sql) => {
    statements.push(sql);
    return [{ enabled: true }];
  } };
  await assert.rejects(new Migration().down(runner), /Disable automatic theme/);
  assert.equal(statements.length, 1);
});

test('auto-theme migration rolls back only when the flag is off', async () => {
  const statements = [];
  const runner = { query: async (sql) => {
    statements.push(sql);
    return [{ enabled: false }];
  } };
  await new Migration().down(runner);
  assert.match(statements[1], /DROP COLUMN IF EXISTS "auto_theme_enabled"/);
});
