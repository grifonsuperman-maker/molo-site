const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { getMetadataArgsStorage } = require('typeorm');
const { SyrveTableLink } = require('../dist/syrve/entities/syrve-table-link.entity.js');
const { CreateSyrveTableLinks2026093000010 } = require('../dist/migrations/2026093000010-CreateSyrveTableLinks.js');

function runner(responses, active = true) {
  const queries = [];
  return {
    queries,
    isTransactionActive: active,
    query: async (sql) => {
      queries.push(sql);
      return responses.shift();
    },
  };
}

test('link schema cannot be created or rewritten by TypeORM synchronize', () => {
  const metadata = getMetadataArgsStorage().tables.find(({ target }) => target === SyrveTableLink);
  assert.equal(metadata.name, 'syrve_table_links');
  assert.equal(metadata.synchronize, false);
});

test('prepared Syrve migration stays out of production startup until schema adoption', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/app.module.ts'), 'utf8');
  const productionRegistry = source.split('const staffPinMigrationOptions = {')[1].split('};')[0];
  assert.doesNotMatch(productionRegistry, /CreateSyrveTableLinks2026093000010/);
  assert.match(source, /migrations: isDisposableSchemaReference[\s\S]*CreateSyrveTableLinks2026093000010/);
});

test('rollback refuses an unprotected check/drop outside a transaction', async () => {
  const queryRunner = runner([], false);
  await assert.rejects(new CreateSyrveTableLinks2026093000010().down(queryRunner), /requires an active transaction/);
  assert.equal(queryRunner.queries.length, 0);
});

test('rollback retains confirmed mappings and sync state when records exist', async () => {
  const queryRunner = runner([[{ present: true }], [], [{ hasLinks: true }]]);
  await assert.rejects(new CreateSyrveTableLinks2026093000010().down(queryRunner), /while mapping records exist/);
  assert.equal(queryRunner.queries.length, 3);
  assert.match(queryRunner.queries[1], /LOCK TABLE "syrve_table_links" IN ACCESS EXCLUSIVE MODE/);
  assert.doesNotMatch(queryRunner.queries.join('\n'), /DROP TABLE/);
});

test('empty-table rollback locks before checking and drops only the owned table', async () => {
  const queryRunner = runner([[{ present: true }], [], [{ hasLinks: false }], []]);
  await new CreateSyrveTableLinks2026093000010().down(queryRunner);
  assert.match(queryRunner.queries[1], /LOCK TABLE/);
  assert.match(queryRunner.queries[2], /SELECT EXISTS/);
  assert.equal(queryRunner.queries[3], 'DROP TABLE "syrve_table_links"');
});

test('rollback safely skips an already absent link table', async () => {
  const queryRunner = runner([[{ present: false }]]);
  await new CreateSyrveTableLinks2026093000010().down(queryRunner);
  assert.equal(queryRunner.queries.length, 1);
});

test('PostgreSQL validation refuses an unapproved or remote database before connecting', async () => {
  const { runSyrveTableLinkValidation } = await import('../scripts/syrve-table-link-validation.mjs');
  await assert.rejects(runSyrveTableLinkValidation({}), /Fresh schema reference is disabled/);
  await assert.rejects(runSyrveTableLinkValidation({
    FRESH_SCHEMA_REFERENCE_ALLOW: 'true', DB_URL: 'postgres://remote/production',
  }), /refuses DB_URL/);
});
