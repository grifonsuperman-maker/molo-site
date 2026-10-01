import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertFreshSchemaReferenceTarget } from './fresh-schema-reference.mjs';

export async function runSyrveStateStorageValidation(env = process.env) {
  assertFreshSchemaReferenceTarget(env);
  if (env !== process.env) throw new Error('Syrve storage validation must use process.env after safety validation.');
  const require = createRequire(import.meta.url);
  const { DataSource } = require('typeorm');
  const { SyrveSettingsStore } = require('../dist/syrve/syrve-settings.store.js');
  const { SyrveStateStore } = require('../dist/syrve/syrve-state.store.js');
  const { CreateSyrveDurableState2026093000050: Migration } = require('../dist/migrations/2026093000050-CreateSyrveDurableState.js');
  const { reduceSyrveOrderState } = require('../dist/syrve/syrve-state-reducer.js');
  const { id, row, probe, batches } = require('../test/helpers/syrve-state-fixtures.js');
  const options = { type:'postgres', host:env.DB_HOST, port:Number(env.DB_PORT || 5432),
    username:env.DB_USER || 'postgres', password:env.DB_PASSWORD || 'postgres', database:env.DB_NAME,
    synchronize:false, entities:[resolve(dirname(fileURLToPath(import.meta.url)),'../dist/**/*.entity.js')],
    extra:{connectionTimeoutMillis:5000, statement_timeout:10000} };
  let source = new DataSource(options); await source.initialize();
  const store = () => new SyrveStateStore(source,new SyrveSettingsStore(source));
  const tableId = randomUUID(), providerId = randomUUID(), organizationId = randomUUID();
  let integrationId, linkId;
  const physical = () => source.query('SELECT * FROM "tables" WHERE id=$1',[tableId]);
  const saved = async () => ({
    link:(await source.query('SELECT * FROM "syrve_table_links" WHERE id=$1',[linkId]))[0],
    state:(await source.query('SELECT * FROM "syrve_table_sync_states" WHERE link_id=$1',[linkId]))[0],
    versions:await source.query('SELECT * FROM "syrve_order_versions" WHERE link_id=$1 ORDER BY order_id',[linkId]),
  });
  try {
    assert.equal(Number((await source.query('SELECT count(*) AS count FROM "syrve_integrations"'))[0].count),0);
    await source.query('INSERT INTO "tables" (id,table_number,status,x,rotation,photo_url) VALUES ($1,$2,\'cleaning\',17,45,\'/existing-storage-ci.jpg\')',
      [tableId,String(3_000_000+Math.floor(Math.random()*1_000_000))]);
    integrationId = (await source.query('INSERT INTO "syrve_integrations" (display_name,organization_id,status) VALUES (\'Synthetic storage CI\',$1,\'connected\') RETURNING id',[organizationId]))[0].id;
    linkId = (await source.query('INSERT INTO "syrve_table_links" (integration_id,organization_id,molo_table_id,syrve_table_id,last_known_number) VALUES ($1,$2,$3,$4,1) RETURNING id',
      [integrationId,organizationId,tableId,providerId]))[0].id;
    const physicalBefore = await physical();
    let captured = await store().capture(tableId);
    await store().recordStaffAction(tableId,'status_changed');
    const delayed = await store().applyObservation(captured,[{orderIds:[],probe:probe(captured.state.scope,[row(captured.state.scope,id(10))])}]);
    assert.equal(delayed.changed,false); assert.deepEqual(delayed.diagnostics,['local_revision_changed']);

    captured = await store().capture(tableId);
    const concurrent = await Promise.all([id(10),id(11)].map((orderId) => store().applyObservation(captured,
      [{orderIds:[],probe:probe(captured.state.scope,[row(captured.state.scope,orderId)])}])));
    assert.equal(concurrent.filter((result) => result.changed).length,1);
    await store().recordStaffAction(tableId,'manual_free');
    const beforeRestart = await store().capture(tableId);
    // Close the actual connection pool and rebuild both the DataSource and
    // adapter: no in-memory state can survive this restart.
    await source.destroy(); source = new DataSource(options); await source.initialize();
    assert.deepEqual(await store().capture(tableId),beforeRestart);
    const activeId = beforeRestart.state.activeSyrveOrderIds[0];
    const closed = await store().applyObservation(beforeRestart,batches(beforeRestart,[row(beforeRestart.state.scope,activeId,'Closed',200)]));
    assert.deepEqual(closed.state.activeSyrveOrderIds,[activeId]);
    assert.deepEqual(closed.state.manuallyFreedSyrveOrderIds,[activeId]);
    assert.ok(closed.diagnostics.includes('visibility_not_verified'));
    // Save a synthetic trusted tombstone fixture without exposing any proof
    // setter in the production adapter. Then replay an older open observation.
    const c = await store().capture(tableId);
    const tombstone = reduceSyrveOrderState(c.state,{expectedScope:c.state.scope,currentScope:c.state.scope,
      expectedRevision:c.state.localRevision,nextRevision:randomUUID(),probe:batches(c,[row(c.state.scope,activeId,'Closed',300)]),visibilityVerified:true}).state;
    await source.transaction(async (manager) => {
      await manager.query('UPDATE "syrve_table_links" SET last_syrve_state=\'closed\', active_syrve_order_ids=\'{}\',manually_freed_syrve_order_ids=\'{}\' WHERE id=$1',[linkId]);
      await manager.query('UPDATE "syrve_order_versions" SET timestamp=$2,state=\'closed\',fingerprint=$3 WHERE link_id=$1 AND order_id=$4',
        [linkId,300,tombstone.orderVersions[0].fingerprint,activeId]);
      await manager.query('UPDATE "syrve_table_sync_states" SET local_revision=$2 WHERE link_id=$1',[linkId,tombstone.localRevision]);
    });
    captured = await store().capture(tableId);
    const replay = await store().applyObservation(captured,[{orderIds:[],probe:probe(captured.state.scope,[row(captured.state.scope,activeId,'New',299)])}]);
    assert.deepEqual(replay.state.activeSyrveOrderIds,[]); assert.ok(replay.diagnostics.includes('stale_order'));

    // A late failure after ledger and link writes must roll back all three.
    captured = await store().capture(tableId); const beforeFailure = await saved();
    await source.query(`CREATE FUNCTION molo_syrve_storage_ci_fail() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'synthetic storage failure'; END $$`);
    await source.query('CREATE TRIGGER storage_ci_failure BEFORE UPDATE ON "syrve_table_sync_states" FOR EACH ROW EXECUTE FUNCTION molo_syrve_storage_ci_fail()');
    await assert.rejects(store().applyObservation(captured,[{orderIds:[],probe:probe(captured.state.scope,[row(captured.state.scope,id(12))])}]),/synthetic storage failure/);
    assert.deepEqual(await saved(),beforeFailure);
    await source.query('DROP FUNCTION molo_syrve_storage_ci_fail() CASCADE');

    // Recheck/reconnect fences old work but must retain this binding's ledger.
    captured = await store().capture(tableId); const beforeReconfigure = await saved();
    await source.query('UPDATE "syrve_integrations" SET configuration_revision=uuid_generate_v4() WHERE id=$1',[integrationId]);
    await assert.rejects(store().applyObservation(captured,[]),(error) => error.getStatus()===409);
    const refreshed = await store().capture(tableId);
    assert.notEqual(refreshed.state.localRevision,captured.state.localRevision);
    assert.deepEqual((await saved()).versions,beforeReconfigure.versions);

    // Actual PostgreSQL rejects invalid timestamps and contradictory outcomes.
    for (const [timestamp,outcome,fingerprint] of [[-1,'open','a'.repeat(64)],['9007199254740992','open','a'.repeat(64)],[0,'open',null],[0,'unknown','bad']]) {
      await assert.rejects(source.query('INSERT INTO "syrve_order_versions" (link_id,order_id,timestamp,state,fingerprint) VALUES ($1,$2,$3,$4,$5)',
        [linkId,randomUUID(),timestamp,outcome,fingerprint]),(error) => error.code==='23514');
    }

    // Grow the durable set via bounded discoveries; then restore and validate
    // the complete multi-probe plan on a second connection pool.
    const ids = Array.from({length:4201},(_,index) => id(100+index));
    for (let offset=0;offset<ids.length;offset+=1500) {
      captured = await store().capture(tableId);
      const existing = captured.state.activeSyrveOrderIds;
      const values = [...existing,...ids.slice(offset,offset+1500)].map((orderId) => row(captured.state.scope,orderId,'New',400));
      const parts = batches(captured,values); parts[0].probe.byTable=probe(captured.state.scope,values.slice(existing.length)).byTable;
      await store().applyObservation(captured,parts);
    }
    await source.destroy(); source = new DataSource(options); await source.initialize();
    captured = await store().capture(tableId);
    assert.deepEqual(captured.orderIds.map((part) => part.length),[2000,2000,201]);
    const beforePartial = await saved();
    const parts = batches(captured,ids.map((orderId) => row(captured.state.scope,orderId,'Closed',500)));
    parts.pop(); assert.equal((await store().applyObservation(captured,parts)).changed,false);
    assert.deepEqual(await saved(),beforePartial);

    const migration = new Migration();
    await assert.rejects(source.transaction((manager) => migration.down(manager.queryRunner)),/saved state exists/);
    assert.deepEqual(await saved(),beforePartial);
    assert.deepEqual(await physical(),physicalBefore);
    await source.query('DELETE FROM "syrve_integrations" WHERE id=$1',[integrationId]); integrationId=null;
    assert.equal((await source.query('SELECT count(*)::int AS count FROM "syrve_order_versions" WHERE link_id=$1',[linkId]))[0].count,0);
    await source.transaction(async (manager) => { await migration.down(manager.queryRunner); await migration.up(manager.queryRunner); });
    assert.deepEqual(await physical(),physicalBefore);
  } finally {
    try {
      await source.query('DROP FUNCTION IF EXISTS molo_syrve_storage_ci_fail() CASCADE');
      if (integrationId) await source.query('DELETE FROM "syrve_integrations" WHERE id=$1',[integrationId]);
      await source.query('DELETE FROM "tables" WHERE id=$1',[tableId]);
    } finally { await source.destroy(); }
  }
}

if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  runSyrveStateStorageValidation().then(() => process.stdout.write('Syrve durable storage PostgreSQL validation passed.\n'))
    .catch((error) => { console.error(`Syrve durable storage validation failed: ${error.message}`); process.exitCode=1; });
}
