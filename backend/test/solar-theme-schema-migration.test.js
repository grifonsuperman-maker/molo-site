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

const transaction = (onQuery) => ({
  isTransactionActive: true,
  query: onQuery,
});

test('migration locks restaurant, adds disabled flag and verifies schema', async () => {
  const statements = [];
  const runner = transaction(async (sql) => {
    statements.push(sql);
    if (sql.includes('AS present')) return [{ present: false }];
    if (sql.includes('data_type, is_nullable')) return [
      { data_type: 'boolean', is_nullable: 'NO', column_default: 'false' },
    ];
    return [];
  });
  await new Migration().up(runner);
  assert.match(statements[0], /LOCK TABLE "restaurant" IN ACCESS EXCLUSIVE MODE/);
  assert.match(statements[1], /information_schema.columns/);
  assert.match(statements[2], /ADD COLUMN "auto_theme_enabled" boolean NOT NULL DEFAULT false/);
  assert.match(statements[3], /information_schema.columns/);
});

test('up rejects a preexisting column even with matching schema', async () => {
  const statements = [];
  const runner = transaction(async (sql) => {
    statements.push(sql);
    return [{ present: true }];
  });
  await assert.rejects(new Migration().up(runner), /already exists/);
  assert.equal(statements.length, 2);
});

test('up rejects an unexpected resulting schema', async () => {
  const runner = transaction(async (sql) =>
    sql.includes('AS present') ? [{ present: false }] :
    sql.includes('data_type, is_nullable')
      ? [{ data_type: 'text', is_nullable: 'YES', column_default: null }]
      : [],
  );
  await assert.rejects(new Migration().up(runner), /unexpected schema/);
});

test('down locks restaurant before checking active auto flags', async () => {
  const statements = [];
  const runner = transaction(async (sql) => {
    statements.push(sql);
    return [{ enabled: true }];
  });
  await assert.rejects(new Migration().down(runner), /Disable automatic theme/);
  assert.match(statements[0], /ACCESS EXCLUSIVE MODE/);
  assert.equal(statements.length, 2);
});

test('down drops column only after exclusive lock and inactive check', async () => {
  const statements = [];
  const runner = transaction(async (sql) => {
    statements.push(sql);
    return [{ enabled: false }];
  });
  await new Migration().down(runner);
  assert.match(statements[0], /ACCESS EXCLUSIVE MODE/);
  assert.match(statements[2], /DROP COLUMN "auto_theme_enabled"/);
});

test('migration refuses operations outside an active transaction', async () => {
  const runner = { isTransactionActive: false, query: () => assert.fail('no writes') };
  await assert.rejects(new Migration().up(runner), /active transaction/);
  await assert.rejects(new Migration().down(runner), /active transaction/);
});
