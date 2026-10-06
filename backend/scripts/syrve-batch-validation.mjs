import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertFreshSchemaReferenceTarget } from './fresh-schema-reference.mjs';

// Production worker/client and real PostgreSQL; only Syrve HTTP is synthetic.
// This validator can run only against the disposable loopback CI database.
export async function runSyrveBatchValidation(env = process.env) {
  assertFreshSchemaReferenceTarget(env);
  if (env !== process.env) throw new Error('Batch validation must use the validated process environment.');
  const require = createRequire(import.meta.url);
  const { DataSource } = require('typeorm');
  const { TableEntity } = require('../dist/tables/entities/table.entity.js');
  const { SyrveSettingsStore } = require('../dist/syrve/syrve-settings.store.js');
  const { SyrveStateStore } = require('../dist/syrve/syrve-state.store.js');
  const { SyrveWorkerStore } = require('../dist/syrve/syrve-worker.store.js');
  const { SyrveWorkerService } = require('../dist/syrve/syrve-worker.service.js');
  const { SyrveIntegrationService } = require('../dist/syrve/syrve-integration.service.js');
  const { SyrveActivationStore } = require('../dist/syrve/syrve-activation.store.js');
  const { SyrveStaffActionsService } = require('../dist/syrve/syrve-staff-actions.service.js');
  const { activationBindings } = require('../dist/syrve/syrve-activation.js');
  const { batchTransport } = require('../test/helpers/syrve-batch-transport.js');
  const { id } = require('../test/helpers/syrve-state-fixtures.js');
  const options = { type: 'postgres', host: env.DB_HOST, port: Number(env.DB_PORT || 5432),
    username: env.DB_USER || 'postgres', password: env.DB_PASSWORD || 'postgres', database: env.DB_NAME,
    synchronize: false, entities: [fileURLToPath(new URL('../dist/**/*.entity.js', import.meta.url))],
    extra: { application_name: 'syrve-batch-ci', connectionTimeoutMillis: 5000, statement_timeout: 10000 } };
  const source = new DataSource(options), other = new DataSource({ ...options,
    extra: { ...options.extra, application_name: 'syrve-batch-ci-other' } });
  const previousFetch = globalThis.fetch;
  const previousEnv = Object.fromEntries(['SYRVE_CREDENTIALS_SECRET', 'SYRVE_APP_ID', 'SYRVE_APP_CLIENT_SECRET'].map(key => [key, env[key]]));
  env.SYRVE_CREDENTIALS_SECRET = 'synthetic-batch-ci-secret'; delete env.SYRVE_APP_ID; delete env.SYRVE_APP_CLIENT_SECRET;
  const settings = (db = source) => new SyrveSettingsStore(db);
  const activation = (db = source) => new SyrveActivationStore(db, settings(db));
  const store = () => new SyrveWorkerStore(source, settings());
  try {
    await source.initialize(); await other.initialize();
    const originalBookings = await source.query('SELECT * FROM bookings ORDER BY id');
    await fixture(60, false, async h => {
      // Bulk preparation is one transaction, including its JSONB state insert.
      const claim = await store().claim(); assert.equal(claim.status, 'claimed');
      await source.query("CREATE FUNCTION syrve_batch_ci_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic batch failure'; END; $$");
      await source.query(`CREATE TRIGGER syrve_batch_ci_fail BEFORE INSERT ON syrve_table_sync_states
        FOR EACH ROW WHEN (NEW.molo_table_id='${h.tables[0]}'::uuid) EXECUTE FUNCTION syrve_batch_ci_fail()`);
      try {
        await assert.rejects(store().captureBatch(claim.lease), /synthetic batch failure/);
        assert.equal((await source.query('SELECT count(*)::int AS n FROM syrve_table_sync_states'))[0].n, 0);
        assert.equal((await source.query('SELECT count(*)::int AS n FROM syrve_order_versions'))[0].n, 0);
      } finally { await source.query('DROP TRIGGER syrve_batch_ci_fail ON syrve_table_sync_states'); }
      const captures = await store().captureBatch(claim.lease);
      assert.equal(captures.length, 60); await store().guardBatch(claim.lease, captures);
      for (const capture of [captures[0], captures[59]]) {
        const single = await new SyrveStateStore(source, settings()).capture(capture.state.scope.moloTableId);
        assert.deepEqual(single, capture);
      }
      await store().release(claim.lease);
      const calls = h.transport.calls.length;
      assert.deepEqual(await h.worker.tick(), { status: 'observed', processed: 60 });
      assert.equal(h.transport.calls.length - calls, 15);
      assert.equal((await h.physical()).filter(table => table.status === 'occupied').length, 60);
      assert.equal((await source.query('SELECT count(*)::int AS n FROM syrve_order_versions'))[0].n, 60);

      // Closing one of two bills must not free that table.
      const extra = h.bill(0, id(39000), 'New', 101);
      h.rows = [...h.rows, extra]; await h.due(); assert.equal((await h.worker.tick()).status, 'observed');
      h.rows = h.rows.map(row => row.id === extra.id ? h.bill(0, extra.id, 'Closed', 102) : row);
      await h.due(); assert.equal((await h.worker.tick()).status, 'observed');
      assert.equal((await h.physical())[0].status, 'occupied');

      // A real staff hook fences one table while the other 59 accept closure.
      h.rows = h.rows.map(row => ({ ...row, timestamp: 200, order: { ...row.order, status: 'Closed' } }));
      let afterStaff;
      h.hold = async () => {
        await new SyrveStaffActionsService(other, settings(other)).run(h.tables[0], 'status_changed',
          manager => manager.query("UPDATE tables SET status='cleaning',updated_at=clock_timestamp() WHERE id=$1", [h.tables[0]]));
        afterStaff = await h.saved(0);
      };
      await h.due(); const manual = await h.worker.tick();
      assert.deepEqual(manual, { status: 'stale', processed: 59, code: 'SYRVE_LOCAL_STATE_CHANGED' });
      assert.deepEqual(await h.saved(0), afterStaff);
      assert.equal((await h.physical())[0].status, 'cleaning');
      assert.equal((await h.physical()).slice(1).every(table => table.status === 'free'), true);
      assert.equal((await h.job()).failure_count, 1);
      await h.due(); assert.equal((await h.worker.tick()).status, 'observed');
      assert.equal((await h.physical())[0].status, 'free');
      await new SyrveStaffActionsService(other, settings(other)).run(h.tables[0], 'status_changed',
        manager => manager.query("UPDATE tables SET status='occupied',updated_at=clock_timestamp() WHERE id=$1", [h.tables[0]]));
      await h.due(); assert.equal((await h.worker.tick()).status, 'observed');
      assert.equal((await h.physical())[0].status, 'occupied', 'an already applied closure cannot overwrite a newer manual mark');

      // Direct booking writers can change only microseconds, bypassing the hook.
      h.rows = [...h.rows, h.bill(0, id(41000), 'New', 300), h.bill(1, id(41001), 'New', 300)];
      let beforeMicro;
      h.hold = async () => {
        beforeMicro = await h.saved(0);
        await other.query("UPDATE tables SET updated_at=updated_at+interval '1 microsecond' WHERE id=$1", [h.tables[0]]);
      };
      await h.due(); const micro = await h.worker.tick();
      assert.deepEqual(micro, { status: 'stale', processed: 59, code: 'SYRVE_LOCAL_STATE_CHANGED' });
      assert.deepEqual(await h.saved(0), beforeMicro);
      assert.equal((await h.physical())[1].status, 'occupied');
      assert.equal((await h.saved(1)).versions.some(version => version.order_id === id(41001)), true);
      assert.equal((await h.saved(0)).versions.some(version => version.order_id === id(41000)), false);

      // Bookkeeping failure rolls back the first table's status and order event.
      await h.due(); const next = await store().claim(); assert.equal(next.status, 'claimed');
      const target = h.tables.indexOf(next.lease.links[0].moloTableId); await store().release(next.lease);
      h.rows = [...h.rows, h.bill(target, id(43000), 'New', 400)];
      const beforeFailure = await h.allSaved(), beforePhysical = await h.physical();
      await source.query(`CREATE TRIGGER syrve_batch_ci_fail BEFORE UPDATE ON syrve_worker_state
        FOR EACH ROW WHEN (NEW.last_success_at IS DISTINCT FROM OLD.last_success_at) EXECUTE FUNCTION syrve_batch_ci_fail()`);
      try {
        const failed = await h.worker.tick(); assert.equal(failed.status, 'failed'); assert.equal(failed.processed, 0);
        assert.deepEqual(await h.allSaved(), beforeFailure); assert.deepEqual(await h.physical(), beforePhysical);
      } finally { await source.query('DROP TRIGGER syrve_batch_ci_fail ON syrve_worker_state'); }
      await h.due(); assert.equal((await h.worker.tick()).status, 'observed');
      assert.equal((await h.saved(target)).versions.some(version => version.order_id === id(43000)), true);

      // Shared configuration/consent revocation must still reject the whole batch.
      const beforeDisable = await h.allSaved();
      h.hold = async () => activation(other).disable((await settings().read()).entity.configurationRevision);
      await h.due(); assert.equal((await h.worker.tick()).status, 'stale');
      assert.deepEqual(await h.allSaved(), beforeDisable);
      const beforeDisabledCalls = h.transport.calls.length;
      assert.equal((await h.worker.tick()).status, 'disabled'); assert.equal(h.transport.calls.length, beforeDisabledCalls);
    });

    await fixture(2, true, async h => {
      assert.deepEqual(await h.worker.tick(), { status: 'observed', processed: 2 });
      h.offline = 0; h.rows = [h.bill(0, id(30000), 'Closed', 200), h.bill(1, id(30001), 'Closed', 200)];
      await h.due(); const first = await h.worker.tick(); assert.equal(first.status, 'failed'); assert.equal(first.processed, 1);
      assert.deepEqual((await h.physical()).map(table => table.status), ['occupied', 'free']);
      assert.equal((await h.saved(0)).versions[0].timestamp, '100');
      h.rows = [...h.rows, h.bill(1, id(45000), 'New', 300)];
      await h.due(); assert.equal((await h.worker.tick()).processed, 1);
      assert.deepEqual((await h.physical()).map(table => table.status), ['occupied', 'occupied']);
      assert.equal((await h.job()).failure_count, 1, 'one failed group must not grow healthy-group backoff');
      h.offline = 1; await h.due(); assert.equal((await h.worker.tick()).processed, 1);
      assert.deepEqual((await h.physical()).map(table => table.status), ['free', 'occupied']);
      h.offline = 'all'; const unchanged = await h.allSaved();
      await h.due(); const allFailed = await h.worker.tick(); assert.equal(allFailed.status, 'failed'); assert.equal(allFailed.processed, 0);
      assert.deepEqual(await h.allSaved(), unchanged); assert.deepEqual((await h.physical()).map(table => table.status), ['free', 'occupied']);
    });
    assert.deepEqual(await source.query('SELECT * FROM bookings ORDER BY id'), originalBookings);
  } finally {
    globalThis.fetch = previousFetch;
    for (const [key, value] of Object.entries(previousEnv)) value === undefined ? delete env[key] : env[key] = value;
    if (other.isInitialized) await other.destroy(); if (source.isInitialized) await source.destroy();
  }

  async function fixture(count, twoGroups, validate) {
    const organizationId = randomUUID(), zoneId = randomUUID(), tables = Array.from({ length: count }, () => randomUUID());
    const providers = tables.map((_, index) => id(20000 + index));
    const groups = twoGroups ? providers.map((table, index) => ({ terminalGroupId: id(index + 1), posVersion: '7.7.1', tableIds: [table] }))
      : [{ terminalGroupId: id(1), posVersion: '7.7.1', tableIds: providers }];
    let integrationId, worker;
    const h = { tables, providers, rows: [], offline: null, hold: null };
    h.bill = (index, orderId, status = 'New', timestamp = 100) => ({ id: orderId, organizationId, timestamp, creationStatus: 'Success',
      order: { status, tableIds: [providers[index]], terminalGroupId: groups.find(group => group.tableIds.includes(providers[index])).terminalGroupId } });
    h.rows = providers.map((_, index) => h.bill(index, id(30000 + index)));
    h.transport = batchTransport(organizationId, providers, { groups, override: async path => {
      const idle = await other.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name='syrve-batch-ci' AND state='idle in transaction'");
      assert.equal(idle[0].n, 0, 'no worker transaction may span HTTP');
      if (path.endsWith('/is_alive') && h.offline !== null) return { correlationId: id(9001), isAliveStatus: groups.map((group, index) => ({
        organizationId, terminalGroupId: group.terminalGroupId, isAlive: h.offline !== 'all' && h.offline !== index })) };
      if (path.endsWith('/init_by_table') && h.hold) { const hold = h.hold; h.hold = null; await hold(); }
    } });
    const { SyrveClient } = require('../dist/syrve/syrve-client.js');
    const client = new SyrveClient();
    const integration = () => new SyrveIntegrationService(settings(), {}, client, source.getRepository(TableEntity), activation());
    h.physical = async () => {
      const rows = await source.query('SELECT *,updated_at::text AS physical_updated_at FROM tables WHERE id=ANY($1::uuid[])', [tables]);
      return tables.map(id => rows.find(row => row.id === id));
    };
    h.saved = async index => {
      const [link] = await source.query('SELECT * FROM syrve_table_links WHERE molo_table_id=$1', [tables[index]]);
      return { link, states: await source.query('SELECT * FROM syrve_table_sync_states WHERE link_id=$1', [link.id]),
        versions: await source.query('SELECT * FROM syrve_order_versions WHERE link_id=$1 ORDER BY order_id', [link.id]) };
    };
    h.allSaved = async () => ({ links: await source.query('SELECT * FROM syrve_table_links ORDER BY id'),
      states: await source.query('SELECT * FROM syrve_table_sync_states ORDER BY link_id'),
      versions: await source.query('SELECT * FROM syrve_order_versions ORDER BY link_id,order_id') });
    h.job = async () => (await source.query('SELECT * FROM syrve_worker_state WHERE integration_id=$1', [integrationId]))[0];
    h.due = () => source.query("UPDATE syrve_worker_state SET next_attempt_at='-infinity' WHERE integration_id=$1", [integrationId]);
    try {
      assert.equal((await source.query('SELECT count(*)::int AS n FROM syrve_integrations'))[0].n, 0);
      await source.query("INSERT INTO zones(id,name) VALUES ($1,'Synthetic batch CI')", [zoneId]);
      const number = 90_000_000 + Math.floor(Math.random() * 1_000_000);
      for (const [index, table] of tables.entries()) await source.query("INSERT INTO tables(id,zone_id,table_number,status) VALUES ($1,$2,$3,'free')", [table, zoneId, String(number + index)]);
      const encrypted = integration().encrypt('synthetic-batch-ci-login');
      integrationId = (await source.query("INSERT INTO syrve_integrations(display_name,organization_id,status,api_login_encrypted,api_login_iv,api_login_auth_tag) VALUES ('Synthetic batch CI',$1,'connected',$2,$3,$4) RETURNING id",
        [organizationId, encrypted.encrypted, encrypted.iv, encrypted.authTag]))[0].id;
      for (const [index, table] of tables.entries()) await source.query('INSERT INTO syrve_table_links(integration_id,organization_id,molo_table_id,syrve_table_id,last_known_number) VALUES ($1,$2,$3,$4,$5)',
        [integrationId, organizationId, table, providers[index], index + 1]);
      const snapshot = await settings().read(), local = await source.getRepository(TableEntity).find();
      await source.query('INSERT INTO syrve_sync_activation(integration_id,configuration_revision,enabled,bindings_fingerprint,loading_plan,actor_hash,consented_at) VALUES ($1,$2,true,$3,$4::jsonb,$5,clock_timestamp())',
        [integrationId, snapshot.entity.configurationRevision, activationBindings(snapshot, local), JSON.stringify(h.transport.plan), 'a'.repeat(64)]);
      worker = new SyrveWorkerService(source, settings(), integration()); h.worker = worker;
      globalThis.fetch = (url, request) => { h.transport.setRows(h.rows); return h.transport.fetch(url, request); };
      await validate(h);
    } finally {
      if (worker) await worker.onModuleDestroy();
      await source.query('DROP TRIGGER IF EXISTS syrve_batch_ci_fail ON syrve_table_sync_states');
      await source.query('DROP TRIGGER IF EXISTS syrve_batch_ci_fail ON syrve_worker_state');
      await source.query('DROP FUNCTION IF EXISTS syrve_batch_ci_fail()');
      if (integrationId) await source.query('DELETE FROM syrve_integrations WHERE id=$1', [integrationId]);
      await source.query('DELETE FROM tables WHERE id=ANY($1::uuid[])', [tables]);
      await source.query('DELETE FROM zones WHERE id=$1', [zoneId]);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runSyrveBatchValidation()
  .then(() => process.stdout.write('Syrve 2/60-table batches, staff fences, group isolation and PostgreSQL rollback validation passed.\n'))
  .catch(error => { console.error(`Syrve batch validation failed: ${error.message}`); process.exitCode = 1; });
