import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertFreshSchemaReferenceTarget } from './fresh-schema-reference.mjs';

export async function runSyrveWorkerValidation(env = process.env) {
  assertFreshSchemaReferenceTarget(env);
  if (env !== process.env) throw new Error('Worker validation must use process.env after safety validation.');
  const require = createRequire(import.meta.url);
  const { DataSource } = require('typeorm');
  const { TableEntity } = require('../dist/tables/entities/table.entity.js');
  const { Zone } = require('../dist/zones/entities/zone.entity.js');
  const { Booking } = require('../dist/bookings/entities/booking.entity.js');
  const { TablesService } = require('../dist/tables/tables.service.js');
  const { TableMapIdentityService } = require('../dist/tables/table-map-identity.service.js');
  const { TableStatusProjectionService } = require('../dist/tables/table-status-projection.service.js');
  const { SyrveSettingsStore } = require('../dist/syrve/syrve-settings.store.js');
  const { SyrveStateStore } = require('../dist/syrve/syrve-state.store.js');
  const { SyrveStaffActionsService } = require('../dist/syrve/syrve-staff-actions.service.js');
  const { SyrveWorkerStore } = require('../dist/syrve/syrve-worker.store.js');
  const { SyrveWorkerRunner } = require('../dist/syrve/syrve-worker.runner.js');
  const { SyrveWorkerService } = require('../dist/syrve/syrve-worker.service.js');
  const { SyrveIntegrationService } = require('../dist/syrve/syrve-integration.service.js');
  const { SyrveClientException } = require('../dist/syrve/syrve-client.js');
  const { CreateSyrveWorkerState2026100100060: Migration } = require('../dist/migrations/2026100100060-CreateSyrveWorkerState.js');
  const {confirmed,consentDatabase}=require('../test/helpers/syrve-confirmed-worker.js');
  const {SyrveActivationStore}=require('../dist/syrve/syrve-activation.store.js');
  const { id, row, probe } = require('../test/helpers/syrve-state-fixtures.js');
  const options = { type:'postgres',host:env.DB_HOST,port:Number(env.DB_PORT || 5432),username:env.DB_USER || 'postgres',
    password:env.DB_PASSWORD || 'postgres',database:env.DB_NAME,synchronize:false,
    entities:[fileURLToPath(new URL('../dist/**/*.entity.js',import.meta.url))],
    extra:{application_name:'syrve-worker-ci',connectionTimeoutMillis:5000,statement_timeout:10000} };
  let source=new DataSource(options); await source.initialize();
  const other=new DataSource(options); await other.initialize();
  const tableId=randomUUID(),zoneId=randomUUID(),org=randomUUID(),provider=randomUUID();
  let integrationId,linkId,trigger=false;
  const oldSecret=env.SYRVE_CREDENTIALS_SECRET; env.SYRVE_CREDENTIALS_SECRET='synthetic-worker-ci-secret-only';
  let reads=0, response=(scope,ids)=>probe(scope,[row(scope,id(10))],ids);
  const store=(db=source)=>new SyrveWorkerStore(db,new SyrveSettingsStore(db));
  const state=()=>new SyrveStateStore(source,new SyrveSettingsStore(source));
  const bridge=()=>new SyrveIntegrationService(new SyrveSettingsStore(source),{},
    {probeLoadedOrders:async(base,login,organization,tables,ids,controls)=>{
      assert.equal(login,'synthetic-worker-login'); assert.equal(organization,org); assert.deepEqual(tables,[provider]);
      reads++; const capture=await state().capture(tableId); return confirmed(capture,ids,controls,(c,values)=>response(c.state.scope,values));
    }},source.getRepository(TableEntity),new SyrveActivationStore(source,new SyrveSettingsStore(source)));
  const runner=(read)=>new SyrveWorkerRunner(store(),read ? ((c,ids,controls)=>confirmed(c,ids,controls,read)) : ((c,ids,controls)=>bridge().probeWorkerOrders(c,ids,controls)));
  const due=()=>source.query('UPDATE "syrve_worker_state" SET next_attempt_at=clock_timestamp()-interval \'1 second\' WHERE integration_id=$1',[integrationId]);
  const saved=async()=>({link:await source.query('SELECT * FROM "syrve_table_links" WHERE id=$1',[linkId]),
    state:await source.query('SELECT * FROM "syrve_table_sync_states" WHERE link_id=$1',[linkId]),
    versions:await source.query('SELECT * FROM "syrve_order_versions" WHERE link_id=$1 ORDER BY order_id',[linkId])});
  const job=async()=>(await source.query('SELECT * FROM "syrve_worker_state" WHERE integration_id=$1',[integrationId]))[0];
  const physical=()=>source.query('SELECT id,zone_id,table_number,status,x,y,rotation,photo_url FROM "tables" WHERE id=$1',[tableId]);
  const tables=()=>new TablesService(source.getRepository(TableEntity),source.getRepository(Zone),source.getRepository(Booking),
    new TableMapIdentityService(source),new SyrveStaffActionsService(source,new SyrveSettingsStore(source)),
    new TableStatusProjectionService({snapshot:async()=>({syncEnabled:false,tables:new Map()})}));
  try {
    assert.equal(Number((await source.query('SELECT count(*) AS count FROM "syrve_integrations"'))[0].count),0);
    await source.query('INSERT INTO "zones" (id,name) VALUES ($1,\'Synthetic worker CI\')',[zoneId]);
    await source.query('INSERT INTO "tables" (id,zone_id,table_number,status,x,y,rotation,photo_url) VALUES ($1,$2,$3,\'free\',17,19,45,\'/existing-worker-ci.jpg\')',[tableId,zoneId,String(7_000_000+Math.floor(Math.random()*1_000_000))]);
    const encrypted=bridge().encrypt('synthetic-worker-login'); // Existing AES-GCM implementation, synthetic fixture only.
    integrationId=(await source.query('INSERT INTO "syrve_integrations" (display_name,organization_id,status,api_login_encrypted,api_login_iv,api_login_auth_tag) VALUES (\'Synthetic worker CI\',$1,\'connected\',$2,$3,$4) RETURNING id',[org,encrypted.encrypted,encrypted.iv,encrypted.authTag]))[0].id;
    linkId=(await source.query('INSERT INTO "syrve_table_links" (integration_id,organization_id,molo_table_id,syrve_table_id,last_known_number) VALUES ($1,$2,$3,$4,1) RETURNING id',[integrationId,org,tableId,provider]))[0].id;
    // Fully connected, credentialed DB still cannot activate the runtime provider.
    const disabled=new SyrveWorkerService(source,new SyrveSettingsStore(source),bridge());
    assert.equal((await disabled.tick()).status,'disabled'); await disabled.onModuleDestroy(); assert.equal(reads,0);
    assert.equal(await job(),undefined);
    await consentDatabase(source,new SyrveSettingsStore(source));

    // Independent pools contend through real row/advisory locks, without HTTP transactions.
    const claims=await Promise.all([store().claim(),store(other).claim()]);
    assert.deepEqual(claims.map(c=>c.status).sort(),['busy','claimed']);
    const first=claims.find(c=>c.status==='claimed').lease; await store().release(first);
    const beforePhysical=await physical(); assert.deepEqual(await runner().run(),{status:'observed',processed:1});
    assert.deepEqual(await physical(),beforePhysical); assert.deepEqual((await saved()).link[0].active_syrve_order_ids,[id(10)]);
    assert.ok((await job()).last_success_at instanceof Date);

    await due(); let arrived,resume;
    const entered=new Promise(yes=>arrived=yes), waiting=new Promise(yes=>resume=yes);
    const p=runner(async(c,ids)=>{arrived();await waiting;return probe(c.state.scope,[row(c.state.scope,id(10),'New',101)],ids);}).run();
    await entered;
    assert.equal(Number((await other.query("SELECT count(*) AS count FROM pg_stat_activity WHERE application_name='syrve-worker-ci' AND state='idle in transaction'"))[0].count),0);
    assert.equal((await store(other).claim()).status,'busy');
    await tables().setWaiterStatus(tableId,'free'); const afterStaff=await saved();
    assert.deepEqual(afterStaff.link[0].manually_freed_syrve_order_ids,[id(10)]);
    resume(); assert.equal((await p).code,'SYRVE_LOCAL_STATE_CHANGED'); assert.deepEqual(await saved(),afterStaff);

    await due(); const old=(await store().claim()).lease, capture=await state().capture(tableId);
    await source.query('UPDATE "syrve_worker_state" SET lease_until=clock_timestamp()-interval \'1 second\' WHERE integration_id=$1',[integrationId]);
    const replacement=(await store(other).claim()).lease; assert.notEqual(old.id,replacement.id);
    await assert.rejects(store().apply(old,capture,[{orderIds:capture.orderIds[0],probe:probe(capture.state.scope,[row(capture.state.scope,id(11))])}]),e=>e.getStatus()===409);
    await assert.rejects(store().failure(old,linkId,'SYRVE_TIMEOUT'),e=>e.getStatus()===409);
    await store().release(old); assert.equal((await job()).lease_id,replacement.id); assert.deepEqual(await saved(),afterStaff);
    await store(other).release(replacement);

    await due(); const beforeError=await saved(), lastSuccess=(await job()).last_success_at;
    assert.equal((await runner(()=>{throw new SyrveClientException('SYRVE_RATE_LIMITED');}).run()).code,'SYRVE_RATE_LIMITED');
    assert.deepEqual(await saved(),beforeError); assert.deepEqual((await job()).last_success_at,lastSuccess);
    assert.equal((await job()).last_error_code,'SYRVE_RATE_LIMITED');
    await source.destroy(); source=new DataSource(options); await source.initialize();
    assert.equal((await runner(()=>assert.fail('persistent backoff ignored')).run()).status,'backoff');
    assert.ok((await job()).next_attempt_at-Date.now()>50_000);
    await due(); response=(scope,ids)=>probe(scope,[row(scope,id(10),'New',200),row(scope,id(11),'New',200)],ids);
    assert.equal((await runner().run()).status,'observed'); assert.equal((await job()).failure_count,0);
    assert.deepEqual((await saved()).link[0].manually_freed_syrve_order_ids,[id(10)]);

    // Fail the last DB write, after the real ledger/link writes, to prove atomic rollback.
    await due(); const beforeRollback=await saved();
    await source.query('CREATE FUNCTION syrve_worker_ci_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION \'synthetic worker failure\'; END; $$');
    await source.query('CREATE TRIGGER syrve_worker_ci_fail BEFORE UPDATE ON "syrve_worker_state" FOR EACH ROW WHEN (NEW.last_success_at IS DISTINCT FROM OLD.last_success_at OR NEW.failure_count IS DISTINCT FROM OLD.failure_count) EXECUTE FUNCTION syrve_worker_ci_fail()'); trigger=true;
    assert.equal((await runner((c,ids)=>probe(c.state.scope,[row(c.state.scope,id(12),'New',300)],ids)).run()).status,'failed');
    assert.deepEqual(await saved(),beforeRollback);
    await source.query('DROP TRIGGER syrve_worker_ci_fail ON "syrve_worker_state"'); await source.query('DROP FUNCTION syrve_worker_ci_fail()'); trigger=false;

    // Durable full ledgers cannot be shortened to one response-size observation.
    const ids=Array.from({length:4201},(_,n)=>id(1000+n));
    await source.query('UPDATE "syrve_table_links" SET last_syrve_state=\'open\',active_syrve_order_ids=$2,manually_freed_syrve_order_ids=$2 WHERE id=$1',[linkId,ids]);
    await source.query('DELETE FROM "syrve_order_versions" WHERE link_id=$1',[linkId]);
    await source.query('INSERT INTO "syrve_order_versions" (link_id,order_id,timestamp,state,fingerprint) SELECT $1,id,100,\'open\',$3 FROM unnest($2::uuid[]) AS value(id)',[linkId,ids,'b'.repeat(64)]);
    await due(); const largeBefore=await saved(), seen=[];
    const partial=await runner((c,orderIds)=>{
      seen.push(orderIds); const value=probe(c.state.scope,orderIds.map(value=>row(c.state.scope,value,'New',400)),orderIds);value.byTable=[];
      if(seen.length===3) value.checks.ordersById={status:'error',code:'SYRVE_INVALID_RESPONSE'};return value;
    }).run();
    assert.equal(partial.status,'failed'); assert.deepEqual(seen.map(x=>x.length),[2000,2000,201]);
    assert.deepEqual(seen.flat(),ids); assert.deepEqual(await saved(),largeBefore);
    await due(); seen.length=0;
    assert.equal((await runner((c,orderIds)=>{seen.push(orderIds);const value=probe(c.state.scope,orderIds.map(value=>row(c.state.scope,value,'New',401)),orderIds);value.byTable=[];return value;}).run()).status,'observed');
    assert.deepEqual(seen.flat(),ids); assert.equal((await saved()).versions.length,4201);
    assert.ok((await saved()).versions.every(v=>Number(v.timestamp)===401));
    assert.deepEqual((await saved()).link[0].manually_freed_syrve_order_ids,ids);

    // Rotate settings during a delayed probe; neither ledger nor bookkeeping accepts it.
    await due(); let configured,finish;
    const pending=new Promise(yes=>configured=yes), held=new Promise(yes=>finish=yes);
    const late=runner(async(c,ids)=>{configured();await held;const value=probe(c.state.scope,[],ids);return value;}).run();
    await pending; await source.query('UPDATE "syrve_integrations" SET configuration_revision=uuid_generate_v4() WHERE id=$1',[integrationId]);
    const scopedBefore=await saved(), jobBefore=await job(); assert.equal((await store(other).claim()).status,'disabled');
    finish(); assert.equal((await late).status,'stale'); assert.deepEqual(await saved(),scopedBefore);
    assert.deepEqual((await job()).last_success_at,jobBefore.last_success_at);
    assert.equal((await job()).last_error_code,jobBefore.last_error_code);
    await consentDatabase(source,new SyrveSettingsStore(source));
    const next=(await store(other).claim()).lease; await store(other).release(next);
    assert.equal((await job()).last_success_at,null);

    await assert.rejects(source.transaction(m=>new Migration().down(m.queryRunner)),/saved worker state exists/);
    await source.query('DELETE FROM "syrve_integrations" WHERE id=$1',[integrationId]);
    assert.equal(await job(),undefined);
    integrationId=null;
    await source.transaction(async(m)=>{await new Migration().down(m.queryRunner);await new Migration().up(m.queryRunner);});
  } finally {
    try {
      if(trigger) {await source.query('DROP TRIGGER IF EXISTS syrve_worker_ci_fail ON "syrve_worker_state"');await source.query('DROP FUNCTION IF EXISTS syrve_worker_ci_fail()');}
      if(integrationId) await source.query('DELETE FROM "syrve_integrations" WHERE id=$1',[integrationId]);
      await source.query('DELETE FROM "tables" WHERE id=$1',[tableId]);await source.query('DELETE FROM "zones" WHERE id=$1',[zoneId]);
    } finally {
      if(oldSecret===undefined) delete env.SYRVE_CREDENTIALS_SECRET; else env.SYRVE_CREDENTIALS_SECRET=oldSecret;
      await source.destroy();await other.destroy();
    }
  }
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  runSyrveWorkerValidation().then(()=>process.stdout.write('Syrve consented worker PostgreSQL validation passed.\n'))
    .catch(error=>{console.error(`Syrve worker validation failed: ${error.message}`);process.exitCode=1;});
}
