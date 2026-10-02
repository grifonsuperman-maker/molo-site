import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertFreshSchemaReferenceTarget } from './fresh-schema-reference.mjs';

// Disposable PostgreSQL only; no restaurant connection or live Syrve transport.
export async function runSyrveTableLoadingValidation(env = process.env) {
  assertFreshSchemaReferenceTarget(env);
  if (env !== process.env) throw new Error('Loading validation must use process.env after safety validation.');
  const require=createRequire(import.meta.url),{DataSource}=require('typeorm');
  const {SyrveSettingsStore}=require('../dist/syrve/syrve-settings.store.js');
  const {SyrveTableLoadingStore}=require('../dist/syrve/syrve-table-loading.store.js');
  const {SyrveTableLoadingService}=require('../dist/syrve/syrve-table-loading.service.js');
  const {SyrveIntegrationService}=require('../dist/syrve/syrve-integration.service.js');
  const {SyrveClientException}=require('../dist/syrve/syrve-client.js');
  const {SyrveWorkerStore}=require('../dist/syrve/syrve-worker.store.js');
  const options={type:'postgres',host:env.DB_HOST,port:Number(env.DB_PORT||5432),username:env.DB_USER||'postgres',password:env.DB_PASSWORD||'postgres',
    database:env.DB_NAME,synchronize:false,entities:[fileURLToPath(new URL('../dist/**/*.entity.js',import.meta.url))],
    extra:{application_name:'syrve-loading-ci',connectionTimeoutMillis:5000,statement_timeout:10000}};
  let source=new DataSource(options);await source.initialize();const other=new DataSource(options);await other.initialize();
  const tableId=randomUUID(),provider=randomUUID(),org=randomUUID(),group=randomUUID();let integrationId,trigger=false;
  const oldSecret=env.SYRVE_CREDENTIALS_SECRET;env.SYRVE_CREDENTIALS_SECRET='synthetic-table-loading-ci-secret';
  const store=(db=source)=>new SyrveTableLoadingStore(db,new SyrveSettingsStore(db));
  const revision=async()=>(await source.query('SELECT configuration_revision FROM "syrve_integrations" WHERE id=$1',[integrationId]))[0].configuration_revision;
  const job=async()=>(await source.query('SELECT * FROM "syrve_worker_state" WHERE integration_id=$1',[integrationId]))[0];
  const physical=()=>source.query('SELECT * FROM "tables" WHERE id=$1',[tableId]);
  const links=()=>source.query('SELECT * FROM "syrve_table_links" WHERE integration_id=$1',[integrationId]);
  const actor={sub:randomUUID(),role:'owner',telegramId:'synthetic',directorSessionVersion:1};
  try {
    assert.equal(Number((await source.query('SELECT count(*) AS count FROM "syrve_integrations"'))[0].count),0);
    await source.query('INSERT INTO "tables" (id,table_number,status,x,rotation,photo_url) VALUES ($1,$2,\'occupied\',17,45,\'/existing-loading-ci.jpg\')',
      [tableId,String(810000+Math.floor(Math.random()*10000))]);
    const encrypted=new SyrveIntegrationService({}, {}, {}, {}).encrypt('synthetic-loading-ci-login');
    integrationId=(await source.query('INSERT INTO "syrve_integrations" (display_name,organization_id,status,api_login_encrypted,api_login_iv,api_login_auth_tag)'
      + ' VALUES (\'Synthetic loading CI\',$1,\'connected\',$2,$3,$4) RETURNING id',[org,encrypted.encrypted,encrypted.iv,encrypted.authTag]))[0].id;
    await source.query('INSERT INTO "syrve_table_links" (integration_id,organization_id,molo_table_id,syrve_table_id,last_known_number) VALUES ($1,$2,$3,$4,1)',
      [integrationId,org,tableId,provider]);
    const beforePhysical=await physical(),beforeLinks=await links(),oldRevision=await revision();
    const captured=await store().capture(oldRevision),also=await store(other).capture(oldRevision);
    const competing=await Promise.allSettled([store().claim(captured),store(other).claim(also)]);
    assert.equal(competing.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(competing.find(r=>r.status==='rejected').reason.getStatus(),409);
    const first=competing.find(r=>r.status==='fulfilled').value;
    assert.notEqual(await revision(),oldRevision);assert.equal((await job()).lease_id,first.leaseId);
    assert.equal((await job()).last_success_at,null);assert.equal((await job()).last_attempt_at,null);
    assert.deepEqual(await physical(),beforePhysical);assert.deepEqual(await links(),beforeLinks);
    assert.equal((await new SyrveWorkerStore(other,new SyrveSettingsStore(other)).claim()).status,'disabled');
    await assert.rejects(store().claim(await store().capture(await revision())),e=>e.getStatus()===409);
    await source.destroy();source=new DataSource(options);await source.initialize();
    await assert.rejects(store().capture(oldRevision),e=>e.getStatus()===409); // Replay remains consumed after restart.
    await store().guard(first);
    await other.query('UPDATE "tables" SET status=\'cleaning\',updated_at=clock_timestamp() WHERE id=$1',[tableId]);
    await assert.rejects(store().guard(first),e=>e.getStatus()===409);
    await source.query('UPDATE "syrve_worker_state" SET lease_until=clock_timestamp()-interval \'1 second\' WHERE integration_id=$1',[integrationId]);
    await source.query("UPDATE \"syrve_worker_state\" SET last_success_at=clock_timestamp(),last_attempt_at=clock_timestamp(),failure_count=2,last_error_code='SYRVE_RATE_LIMITED' WHERE integration_id=$1",[integrationId]);
    const replacement=await store(other).claim(await store(other).capture(await revision()));
    assert.equal((await job()).last_success_at,null);assert.equal((await job()).last_attempt_at,null);assert.equal((await job()).failure_count,0);
    await assert.rejects(store().guard(first),e=>e.getStatus()===409);
    await store().release(first);assert.equal((await job()).lease_id,replacement.leaseId);
    await store(other).release(replacement);

    const rollbackRevision=await revision(),rollbackJob=await job();
    await source.query("CREATE FUNCTION syrve_loading_ci_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic loading failure'; END; $$");
    await source.query('CREATE TRIGGER syrve_loading_ci_fail BEFORE UPDATE ON "syrve_worker_state" FOR EACH ROW WHEN (NEW.lease_id IS DISTINCT FROM OLD.lease_id) EXECUTE FUNCTION syrve_loading_ci_fail()');trigger=true;
    await assert.rejects(store().claim(await store().capture(rollbackRevision)),/synthetic loading failure/);
    assert.equal(await revision(),rollbackRevision);assert.deepEqual(await job(),rollbackJob);
    await source.query('DROP TRIGGER syrve_loading_ci_fail ON "syrve_worker_state"');await source.query('DROP FUNCTION syrve_loading_ci_fail()');trigger=false;

    let commands=0,fail=false;
    const client={probeOrders:async(base,login,organization,tables,known)=>{
      assert.equal(login,'synthetic-loading-ci-login');assert.equal(organization,org);assert.deepEqual(tables,[provider]);assert.deepEqual(known,[]);
      return {organizationId:org,checks:Object.fromEntries(['connection','terminalGroups','restaurantSections','posAvailability','ordersByTable','ordersById']
        .map(key=>[key,{status:key==='ordersById'?'not_checked':'ok',code:null}])),terminalGroups:{active:[{id:group,posVersion:'7.7.1'}],sleeping:[]},
        catalogTables:[{id:provider,terminalGroupId:group,isDeleted:false}],availability:[{terminalGroupId:group,isAlive:true}],byTable:[],byId:null};},
      initializeTables:async(base,login,plan,controls)=>{
        commands++;assert.equal(plan.organizationId,org);assert.deepEqual(plan.groups[0].tableIds,[provider]);await controls.beforeCommand();
        assert.equal(Number((await other.query("SELECT count(*) AS count FROM pg_stat_activity WHERE application_name='syrve-loading-ci' AND state='idle in transaction'"))[0].count),0);
        assert.equal((await new SyrveWorkerStore(other,new SyrveSettingsStore(other)).claim()).status,'disabled');
        if(fail)throw new SyrveClientException('SYRVE_COMMAND_IN_PROGRESS');return {completedGroups:1};}};
    const app=()=>new SyrveTableLoadingService(store(),client);
    const beforeLoad=await physical(),beforeLoadLinks=await links();
    let preview=await app().preview({configurationRevision:await revision()},actor);assert.equal(commands,0);
    let input={configurationRevision:preview.configurationRevision,confirmationProof:preview.confirmation.proof,confirmed:true};
    const result=await app().load(input,actor);assert.equal(result.readCompleted,true);assert.equal(result.commandsConfirmed,true);
    assert.equal(result.syncEnabled,false);assert.equal(result.complete,false);assert.equal(result.statusesApplied,false);assert.equal(result.renamingApplied,false);
    assert.deepEqual(await physical(),beforeLoad);assert.deepEqual(await links(),beforeLoadLinks);assert.equal((await job()).lease_id,null);assert.equal((await job()).last_success_at,null);
    await assert.rejects(app().load(input,actor),e=>e.getStatus()===409);assert.equal(commands,1);
    preview=await app().preview({configurationRevision:await revision()},actor);fail=true;
    input={configurationRevision:preview.configurationRevision,confirmationProof:preview.confirmation.proof,confirmed:true};
    const uncertain=await app().load(input,actor);assert.equal(uncertain.code,'SYRVE_COMMAND_IN_PROGRESS');assert.equal(uncertain.readCompleted,false);
    assert.ok((await job()).lease_id);assert.ok((await job()).lease_until>Date.now());assert.equal((await job()).last_success_at,null);
    assert.deepEqual(await physical(),beforeLoad);assert.deepEqual(await links(),beforeLoadLinks);
    assert.equal(Number((await source.query('SELECT count(*) AS count FROM "syrve_table_sync_states"'))[0].count),0);
    assert.equal(Number((await source.query('SELECT count(*) AS count FROM "syrve_order_versions"'))[0].count),0);
  } finally {
    try {
      if(trigger){await source.query('DROP TRIGGER IF EXISTS syrve_loading_ci_fail ON "syrve_worker_state"');await source.query('DROP FUNCTION IF EXISTS syrve_loading_ci_fail()');}
      if(integrationId)await source.query('DELETE FROM "syrve_integrations" WHERE id=$1',[integrationId]);
      await source.query('DELETE FROM "tables" WHERE id=$1',[tableId]);
    } finally {
      if(oldSecret===undefined)delete env.SYRVE_CREDENTIALS_SECRET;else env.SYRVE_CREDENTIALS_SECRET=oldSecret;
      await source.destroy();await other.destroy();
    }
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  runSyrveTableLoadingValidation().then(()=>process.stdout.write('Syrve table loading PostgreSQL validation passed.\n'))
    .catch(error=>{console.error(`Syrve table loading validation failed: ${error.message}`);process.exitCode=1;});
}
