import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertFreshSchemaReferenceTarget } from './fresh-schema-reference.mjs';

export async function runSyrveTransferValidation(env = process.env) {
  assertFreshSchemaReferenceTarget(env);
  if (env !== process.env) throw new Error('Transfer validation requires the approved disposable environment.');
  const require = createRequire(import.meta.url);
  const { DataSource } = require('typeorm');
  const { SyrveSettingsStore } = require('../dist/syrve/syrve-settings.store.js');
  const { SyrveActivationStore } = require('../dist/syrve/syrve-activation.store.js');
  const { SyrveIntegrationService } = require('../dist/syrve/syrve-integration.service.js');
  const { SyrveWorkerService } = require('../dist/syrve/syrve-worker.service.js');
  const { SyrveStateStore } = require('../dist/syrve/syrve-state.store.js');
  const { TableEntity } = require('../dist/tables/entities/table.entity.js');
  const { SyrveClient } = require('../dist/syrve/syrve-client.js');
  const { consentDatabase } = require('../test/helpers/syrve-confirmed-worker.js');
  const { batchTransport } = require('../test/helpers/syrve-batch-transport.js');
  const { id, row } = require('../test/helpers/syrve-state-fixtures.js');
  const db = new DataSource({ type: 'postgres', host: env.DB_HOST, port: Number(env.DB_PORT || 5432),
    username: env.DB_USER || 'postgres', password: env.DB_PASSWORD || 'postgres', database: env.DB_NAME, synchronize: false,
    entities: [fileURLToPath(new URL('../dist/**/*.entity.js', import.meta.url))],
    extra: { application_name: 'syrve-transfer-ci', connectionTimeoutMillis: 5000, statement_timeout: 10000 } });
  const originals = Object.fromEntries(['SYRVE_CREDENTIALS_SECRET', 'SYRVE_APP_ID', 'SYRVE_APP_CLIENT_SECRET'].map(key => [key, env[key]]));
  env.SYRVE_CREDENTIALS_SECRET = 'synthetic-transfer-ci-secret'; delete env.SYRVE_APP_ID; delete env.SYRVE_APP_CLIENT_SECRET;
  const originalFetch = globalThis.fetch;
  const zone = randomUUID(), organizationId = randomUUID();
  const numbers = [...Array.from({ length: 50 }, (_, n) => n + 1), ...Array.from({ length: 10 }, (_, n) => n + 100)];
  const tables = numbers.map(number => ({ number, molo: randomUUID(), syrve: randomUUID() }));
  const source = tables.find(table => table.number === 39), destination = tables.find(table => table.number === 108), eight = tables.find(table => table.number === 8);
  const scope = table => ({ organizationId, syrveTableId: table.syrve });
  const tx = batchTransport(organizationId, tables.map(table => table.syrve).sort());
  let integrationId, worker;
  await db.initialize();
  try {
    assert.equal(Number((await db.query('SELECT count(*) AS count FROM syrve_integrations'))[0].count), 0);
    await db.query('INSERT INTO zones(id,name) VALUES ($1,\'Synthetic transfer CI\')', [zone]);
    await db.query('INSERT INTO tables(id,zone_id,table_number,status) SELECT id,$1,number,\'free\''
      + ' FROM jsonb_to_recordset($2::jsonb) AS v(id uuid,number varchar)', [zone, JSON.stringify(tables.map(table => ({ id: table.molo, number: String(table.number) })))]);
    const settings = new SyrveSettingsStore(db), activation = new SyrveActivationStore(db, settings);
    const integration = new SyrveIntegrationService(settings, {}, new SyrveClient(), db.getRepository(TableEntity), activation);
    const encrypted = integration.encrypt('synthetic-transfer-login');
    integrationId = (await db.query('INSERT INTO syrve_integrations(display_name,organization_id,status,api_login_encrypted,api_login_iv,api_login_auth_tag)'
      + ' VALUES (\'Synthetic transfer CI\',$1,\'connected\',$2,$3,$4) RETURNING id', [organizationId, encrypted.encrypted, encrypted.iv, encrypted.authTag]))[0].id;
    await db.query('INSERT INTO syrve_table_links(integration_id,organization_id,molo_table_id,syrve_table_id,last_known_number)'
      + ' SELECT $1,$2,molo,syrve,number FROM jsonb_to_recordset($3::jsonb) AS v(molo uuid,syrve uuid,number int)',
      [integrationId, organizationId, JSON.stringify(tables)]);
    await consentDatabase(db, settings);
    globalThis.fetch = tx.fetch;
    worker = new SyrveWorkerService(db, settings, integration); // Actual production batch wiring, real PostgreSQL.
    const due = () => db.query('UPDATE syrve_worker_state SET next_attempt_at=clock_timestamp()-interval \'1 second\' WHERE integration_id=$1', [integrationId]);
    const status = async table => (await db.query('SELECT status FROM tables WHERE id=$1', [table.molo]))[0].status;
    const ledgers = () => db.query('SELECT * FROM syrve_order_versions ORDER BY link_id,order_id');
    const mark = async (table, value) => {
      await db.query('UPDATE tables SET status=$2,updated_at=clock_timestamp() WHERE id=$1', [table.molo, value]);
      await new SyrveStateStore(db, settings).recordStaffAction(table.molo, 'status_changed');
    };
    tx.setRows([row(scope(source), id(10)), row(scope(source), id(11)), row(scope(eight), id(12))]);
    assert.deepEqual(await worker.tick(), { status: 'observed', processed: 60 });
    assert.equal(await status(source), 'occupied'); assert.equal(await status(eight), 'occupied');
    assert.equal(tx.calls.filter(call => call.path.endsWith('/init_by_table')).length, 1);
    assert.equal(Number((await db.query('SELECT count(*) AS count FROM syrve_table_sync_states'))[0].count), 60);

    await due(); tx.setRows([row(scope(destination), id(10), 'Bill', 200), row(scope(source), id(11), 'New', 200), row(scope(eight), id(12), 'Closed', 200)]);
    assert.deepEqual(await worker.tick(), { status: 'observed', processed: 60 });
    assert.equal(await status(source), 'occupied'); assert.equal(await status(destination), 'occupied'); assert.equal(await status(eight), 'free');

    await mark(source, 'cleaning'); await due();
    tx.setRows([row(scope(destination), id(10), 'Bill', 200), row(scope(destination), id(11), 'Bill', 201)]);
    assert.equal((await worker.tick()).status, 'observed'); assert.equal(await status(source), 'free');
    await mark(source, 'occupied'); await mark(destination, 'cleaning'); await due();
    assert.equal((await worker.tick()).status, 'observed');
    assert.equal(await status(source), 'occupied'); assert.equal(await status(destination), 'cleaning'); // Replays preserve later staff actions.

    const versionsBeforeFailure = await ledgers(); await due();
    globalThis.fetch = async (url, request) => new URL(url).pathname.endsWith('/by_id') ? Response.json({}, { status: 429 }) : tx.fetch(url, request);
    const failed = await worker.tick(); assert.equal(failed.code, 'SYRVE_RATE_LIMITED'); assert.equal(failed.processed, 0);
    assert.deepEqual(await ledgers(), versionsBeforeFailure); assert.equal(await status(source), 'occupied'); assert.equal(await status(destination), 'cleaning');

    // A direct physical writer with the same status but a different microsecond
    // must fence the delayed batch, without consuming that table's new bill.
    await due();
    const first = (await db.query('SELECT id,molo_table_id,syrve_table_id FROM syrve_table_links ORDER BY id LIMIT 1'))[0];
    const firstTable = tables.find(table => table.molo === first.molo_table_id);
    tx.setRows([row(scope(destination), id(10), 'Bill', 200), row(scope(destination), id(11), 'Bill', 201), row(scope(firstTable), id(20), 'New', 300)]);
    let changed = false;
    globalThis.fetch = async (url, request) => {
      const response = await tx.fetch(url, request);
      if (!changed && new URL(url).pathname.endsWith('/by_id')) {
        changed = true; await db.query('UPDATE tables SET updated_at=updated_at+interval \'1 microsecond\' WHERE id=$1', [firstTable.molo]);
      }
      return response;
    };
    const beforeFence = await ledgers(), result = await worker.tick();
    assert.equal(changed, true); assert.equal(result.status, 'stale'); assert.equal(result.code, 'SYRVE_LOCAL_STATE_CHANGED');
    assert.ok(!(await ledgers()).some(version => version.order_id === id(20)));
    assert.deepEqual(await ledgers(), beforeFence);

    // Reconfiguration adopts all full ledgers together and never resets their
    // active UUIDs or tombstones while issuing new local capture revisions.
    globalThis.fetch = tx.fetch; tx.setRows([row(scope(destination), id(10), 'Bill', 200), row(scope(destination), id(11), 'Bill', 201)]);
    const oldRevisions = await db.query('SELECT link_id,local_revision FROM syrve_table_sync_states ORDER BY link_id');
    await db.query('UPDATE syrve_integrations SET configuration_revision=uuid_generate_v4() WHERE id=$1', [integrationId]);
    assert.equal((await worker.tick()).status, 'disabled');
    await consentDatabase(db, settings); await due(); assert.equal((await worker.tick()).status, 'observed');
    const adopted = await db.query('SELECT link_id,local_revision FROM syrve_table_sync_states ORDER BY link_id');
    assert.equal(adopted.length, 60); assert.ok(adopted.every((state, index) => state.local_revision !== oldRevisions[index].local_revision));
    assert.deepEqual(await ledgers(), beforeFence);
    assert.deepEqual((await db.query('SELECT table_number FROM tables WHERE zone_id=$1 ORDER BY table_number', [zone])).map(table => table.table_number).sort(), numbers.map(String).sort());
  } finally {
    await worker?.onModuleDestroy(); globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(originals)) value === undefined ? delete env[key] : env[key] = value;
    try {
      if (integrationId) await db.query('DELETE FROM syrve_integrations WHERE id=$1', [integrationId]);
      await db.query('DELETE FROM tables WHERE zone_id=$1', [zone]); await db.query('DELETE FROM zones WHERE id=$1', [zone]);
    } finally { await db.destroy(); }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSyrveTransferValidation().then(() => process.stdout.write('Syrve batched 39 to 108 transfer PostgreSQL validation passed.\n'))
    .catch(error => { console.error('Syrve transfer validation failed: ' + error.message); process.exitCode = 1; });
}
