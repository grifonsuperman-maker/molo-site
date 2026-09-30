import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

import { assertFreshSchemaReferenceTarget } from './fresh-schema-reference.mjs';

// Database constraints and concurrent inserts are tested on real PostgreSQL,
// never a production connection. All fixture rows are removed in finally.
export async function runSyrveTableLinkValidation(env = process.env) {
  assertFreshSchemaReferenceTarget(env);
  if (env !== process.env) {
    throw new Error('Syrve link validation must use process.env after safety validation.');
  }
  const require = createRequire(import.meta.url);
  const { Pool } = require('pg');
  const { CreateSyrveTableLinks2026093000010 } = require('../dist/migrations/2026093000010-CreateSyrveTableLinks.js');
  const pool = new Pool({
    host: env.DB_HOST,
    port: Number(env.DB_PORT || 5432),
    user: env.DB_USER || 'postgres',
    password: env.DB_PASSWORD || 'postgres',
    database: env.DB_NAME,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
  });
  const client = await pool.connect();
  const integrationIds = [randomUUID(), randomUUID()];
  const tableIds = [randomUUID(), randomUUID()];
  const organizationId = randomUUID();
  const syrveTableId = randomUUID();
  const orderIds = [randomUUID(), randomUUID()];
  const insert = `INSERT INTO "syrve_table_links"
    ("integration_id", "organization_id", "molo_table_id", "syrve_table_id", "last_known_number")
    VALUES ($1, $2, $3, $4, 12) RETURNING *`;
  const values = [integrationIds[0], organizationId, tableIds[0], syrveTableId];
  const tableSnapshot = async () => (await client.query(
    'SELECT * FROM "tables" WHERE "id" = ANY($1::uuid[]) ORDER BY "id"', [tableIds],
  )).rows;
  async function rejectsConstraint(sql, parameters, code, constraint) {
    await client.query('SAVEPOINT expected_failure');
    try {
      await assert.rejects(client.query(sql, parameters), (error) => {
        assert.equal(error.code, code);
        if (constraint) assert.equal(error.constraint, constraint);
        return true;
      });
    } finally {
      await client.query('ROLLBACK TO SAVEPOINT expected_failure');
      await client.query('RELEASE SAVEPOINT expected_failure');
    }
  }
  try {
    await client.query('BEGIN');
    await client.query(`INSERT INTO "syrve_integrations" ("id", "display_name")
      SELECT unnest($1::uuid[]), 'Syrve schema test'`, [integrationIds]);
    await client.query(`INSERT INTO "tables" ("id", "table_number", "status", "x", "rotation", "photo_url")
      SELECT unnest($1::uuid[]), 'syrve-schema-test', 'cleaning', 17, 45, '/existing-test-photo.jpg'`, [tableIds]);
    await client.query('COMMIT');
    const physicalBefore = await tableSnapshot();

    await client.query('BEGIN');
    const { rows: [link] } = await client.query(insert, values);
    assert.equal(link.last_syrve_state, 'unknown');
    assert.deepEqual(link.active_syrve_order_ids, []);
    assert.deepEqual(link.manually_freed_syrve_order_ids, []);
    assert.equal(link.last_seen_at, null);
    assert.equal(link.last_synced_at, null);
    await rejectsConstraint(insert, [...values.slice(0, 3), randomUUID()], '23505', 'UQ_syrve_table_links_molo_table');
    await rejectsConstraint(insert, [integrationIds[1], organizationId, tableIds[1], syrveTableId], '23505', 'UQ_syrve_table_links_provider_table');
    await rejectsConstraint(insert, [integrationIds[0], organizationId, randomUUID(), randomUUID()], '23503', 'FK_syrve_table_links_molo_table');
    await rejectsConstraint(insert, [randomUUID(), organizationId, tableIds[1], randomUUID()], '23503', 'FK_syrve_table_links_integration');

    await client.query(`UPDATE "syrve_table_links" SET "last_known_number" = 14,
      "last_syrve_state" = 'open', "active_syrve_order_ids" = $2, "manually_freed_syrve_order_ids" = $3
      WHERE "id" = $1`, [link.id, orderIds, [orderIds[0]]]);
    assert.deepEqual(await tableSnapshot(), physicalBefore, 'link writes must not change any physical table field');
    await rejectsConstraint(`UPDATE "syrve_table_links" SET "manually_freed_syrve_order_ids" = $2 WHERE "id" = $1`, [link.id, [randomUUID()]], '23514', 'CHK_syrve_table_links_order_ids');
    await rejectsConstraint(`UPDATE "syrve_table_links" SET "active_syrve_order_ids" = $2 WHERE "id" = $1`, [link.id, ['not-a-uuid']], '22P02');
    await rejectsConstraint(`UPDATE "syrve_table_links" SET "active_syrve_order_ids" = $2 WHERE "id" = $1`, [link.id, [null]], '23514', 'CHK_syrve_table_links_order_ids');
    await rejectsConstraint(`UPDATE "syrve_table_links" SET "last_syrve_state" = 'closed' WHERE "id" = $1`, [link.id], '23514', 'CHK_syrve_table_links_order_state');
    await rejectsConstraint(`UPDATE "syrve_table_links" SET "last_syrve_state" = 'occupied' WHERE "id" = $1`, [link.id], '23514');
    const { rows: [open] } = await client.query('SELECT * FROM "syrve_table_links" WHERE "id" = $1', [link.id]);
    assert.deepEqual(open.active_syrve_order_ids, orderIds);
    assert.deepEqual(open.manually_freed_syrve_order_ids, [orderIds[0]], 'invalid writes must retain the last valid override');
    await client.query(`UPDATE "syrve_table_links" SET "last_syrve_state" = 'closed',
      "active_syrve_order_ids" = '{}', "manually_freed_syrve_order_ids" = '{}' WHERE "id" = $1`, [link.id]);
    await rejectsConstraint(`UPDATE "syrve_table_links" SET "last_syrve_state" = 'open' WHERE "id" = $1`, [link.id], '23514', 'CHK_syrve_table_links_order_state');

    await assert.rejects(new CreateSyrveTableLinks2026093000010().down({
      isTransactionActive: true,
      query: async (sql) => (await client.query(sql)).rows,
    }), /while mapping records exist/);
    assert.equal((await client.query('SELECT count(*)::int AS count FROM "syrve_table_links" WHERE "id" = $1', [link.id])).rows[0].count, 1);

    await client.query('SAVEPOINT cascade_check');
    await client.query('DELETE FROM "syrve_integrations" WHERE "id" = $1', [integrationIds[0]]);
    assert.equal((await client.query('SELECT count(*)::int AS count FROM "syrve_table_links" WHERE "id" = $1', [link.id])).rows[0].count, 0);
    assert.deepEqual(await tableSnapshot(), physicalBefore, 'deleting integration data must never delete or update MOLO tables');
    await client.query('ROLLBACK TO SAVEPOINT cascade_check');
    await client.query('DELETE FROM "tables" WHERE "id" = $1', [tableIds[0]]);
    assert.equal((await client.query('SELECT count(*)::int AS count FROM "syrve_table_links" WHERE "id" = $1', [link.id])).rows[0].count, 0);
    await client.query('ROLLBACK');

    // Two independent PostgreSQL sessions race to link the same physical table.
    const results = await Promise.allSettled([
      pool.query(insert, values),
      pool.query(insert, [...values.slice(0, 3), randomUUID()]),
    ]);
    assert.equal(results.filter(({ status }) => status === 'fulfilled').length, 1);
    const failed = results.find(({ status }) => status === 'rejected');
    assert.equal(failed.reason.code, '23505');
    assert.equal(failed.reason.constraint, 'UQ_syrve_table_links_molo_table');
    assert.deepEqual(await tableSnapshot(), physicalBefore);
  } finally {
    try {
      await client.query('ROLLBACK');
      await client.query('DELETE FROM "syrve_integrations" WHERE "id" = ANY($1::uuid[])', [integrationIds]);
      await client.query('DELETE FROM "tables" WHERE "id" = ANY($1::uuid[])', [tableIds]);
    } finally {
      client.release();
      await pool.end();
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSyrveTableLinkValidation().then(() => {
    process.stdout.write('Syrve table link PostgreSQL validation passed.\n');
  }).catch((error) => {
    console.error(`Syrve table link validation failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
