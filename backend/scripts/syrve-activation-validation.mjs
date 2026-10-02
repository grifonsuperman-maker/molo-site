import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {AsyncLocalStorage} from 'node:async_hooks';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {assertFreshSchemaReferenceTarget} from './fresh-schema-reference.mjs';

export async function runSyrveActivationValidation(env=process.env){
  assertFreshSchemaReferenceTarget(env);
  if(env!==process.env)throw new Error('Activation validation must use the validated process environment.');
  const require=createRequire(import.meta.url),{DataSource}=require('typeorm');
  const {SyrveSettingsStore}=require('../dist/syrve/syrve-settings.store.js');
  const {SyrveActivationStore}=require('../dist/syrve/syrve-activation.store.js');
  const {SyrveActivationService}=require('../dist/syrve/syrve-activation.service.js');
  const {SyrveTableLoadingStore}=require('../dist/syrve/syrve-table-loading.store.js');
  const {SyrveTableLoadingService}=require('../dist/syrve/syrve-table-loading.service.js');
  const {SyrveIntegrationService}=require('../dist/syrve/syrve-integration.service.js');
  const {SyrveReadinessService}=require('../dist/syrve/syrve-readiness.service.js');
  const {SyrveWorkerService}=require('../dist/syrve/syrve-worker.service.js');
  const {SyrveWorkerStore}=require('../dist/syrve/syrve-worker.store.js');
  const {SyrveStatusReadService}=require('../dist/syrve/syrve-status-read.service.js');
  const {SyrveStateStore}=require('../dist/syrve/syrve-state.store.js');
  const {SyrveClient}=require('../dist/syrve/syrve-client.js');
  const {TableEntity}=require('../dist/tables/entities/table.entity.js');
  const {TableStatusProjectionService}=require('../dist/tables/table-status-projection.service.js');
  const {schemaReference,readSyrveSchemaPreflight}=require('../dist/syrve/syrve-schema-preflight.js');
  const {SYRVE_SCHEMA_REFERENCE}=require('../dist/syrve/syrve-schema-contract.js');
  const options={type:'postgres',host:env.DB_HOST,port:Number(env.DB_PORT||5432),username:env.DB_USER||'postgres',password:env.DB_PASSWORD||'postgres',
    database:env.DB_NAME,synchronize:false,entities:[fileURLToPath(new URL('../dist/**/*.entity.js',import.meta.url))],
    extra:{application_name:'syrve-activation-ci',connectionTimeoutMillis:5000,statement_timeout:10000}};
  let source=new DataSource(options);await source.initialize();
  const other=new DataSource({...options,extra:{...options.extra,application_name:'syrve-activation-ci-other'}});await other.initialize();
  const caller=new AsyncLocalStorage();let idleCaller=0;
  const old=Object.fromEntries(['SYRVE_CREDENTIALS_SECRET','SYRVE_APP_ID','SYRVE_APP_CLIENT_SECRET'].map(key=>[key,env[key]]));
  env.SYRVE_CREDENTIALS_SECRET='synthetic-activation-ci-secret';delete env.SYRVE_APP_ID;delete env.SYRVE_APP_CLIENT_SECRET;
  const org=randomUUID(),provider=randomUUID(),group=randomUUID(),order=randomUUID(),correlation=randomUUID(),actor={sub:randomUUID(),role:'owner',directorSessionVersion:1};
  let tableId,integrationId,created=false,original,trigger=false,rows=[],commandError=false,commandPending=false,missing=false,hold=null,commands=0;
  const previousFetch=globalThis.fetch;
  const client=new SyrveClient();
  const settings=(db=source)=>new SyrveSettingsStore(db),activation=(db=source)=>new SyrveActivationStore(db,settings(db));
  const integration=(db=source)=>new SyrveIntegrationService(settings(db),{},client,db.getRepository(TableEntity),activation(db));
  const service=(db=source)=>{const loading=new SyrveTableLoadingStore(db,settings(db));return new SyrveActivationService(activation(db),settings(db),loading,
    new SyrveTableLoadingService(loading,client),client,new SyrveReadinessService(db));};
  const revision=async()=>(await settings().read()).entity.configurationRevision;
  const job=async()=>(await source.query('SELECT * FROM syrve_worker_state WHERE integration_id=$1',[integrationId]))[0];
  const due=()=>source.query("UPDATE syrve_worker_state SET next_attempt_at='-infinity' WHERE integration_id=$1",[integrationId]);
  const physical=()=>source.query('SELECT * FROM tables WHERE id=$1',[tableId]);
  const saved=async()=>({links:await source.query('SELECT * FROM syrve_table_links ORDER BY id'),states:await source.query('SELECT * FROM syrve_table_sync_states ORDER BY link_id'),
    versions:await source.query('SELECT * FROM syrve_order_versions ORDER BY link_id,order_id'),bookings:await source.query('SELECT * FROM bookings ORDER BY id')});
  const status=async()=>{
    return (await new SyrveStatusReadService(source).snapshot([tableId])).tables.get(tableId)?.state;};
  globalThis.fetch=async(url,request)=>{
    const path=new URL(url).pathname,body=JSON.parse(request.body);
    const name=caller.getStore()||options.extra.application_name;
    idleCaller=Number((await other.query("SELECT count(*) AS count FROM pg_stat_activity WHERE application_name=$1 AND state='idle in transaction'",[name]))[0].count);
    assert.equal(idleCaller,0,'HTTP must not span a transaction in its caller pool');
    let value;
    if(path.endsWith('access_token')){assert.equal(body.apiLogin,'synthetic-activation-ci-login');value={token:'synthetic-ci-token'};}
    else if(path.endsWith('/organizations'))value={organizations:[{id:org,name:'Тест'}]};
    else if(path.endsWith('/terminal_groups'))value={terminalGroups:[{organizationId:org,items:[{id:group,organizationId:org,name:'Каса',posVersion:'7.7.1'}]}],terminalGroupsInSleep:[]};
    else if(path.endsWith('available_restaurant_sections'))value={restaurantSections:[{id:randomUUID(),terminalGroupId:group,name:'Зал',tables:[{id:provider,number:1,name:'Стіл',isDeleted:false}]}]};
    else if(path.endsWith('is_alive'))value={correlationId:correlation,isAliveStatus:[{organizationId:org,terminalGroupId:group,isAlive:true}]};
    else if(path.endsWith('init_by_table')){commands++;assert.equal(body.organizationId,org);assert.equal(body.terminalGroupId,group);assert.deepEqual(body.tableIds,[provider]);
      if(hold)await hold();value={correlationId:correlation};}
    else if(path.endsWith('commands/status'))value=commandError?{state:'Error',exception:'private-ci-error'}:{state:commandPending?'InProgress':'Success'};
    else if(path.endsWith('by_table'))value={correlationId:correlation,orders:rows};
    else if(path.endsWith('by_id'))value={correlationId:correlation,orders:missing?[]:rows.filter(row=>body.orderIds.includes(row.id))};
    else assert.fail('Unexpected Syrve operation '+path);
    return Response.json(value);
  };
  const wrapper=(id,status,timestamp)=>({id,organizationId:org,timestamp,creationStatus:'Success',order:{status,tableIds:[provider],terminalGroupId:group}});
  try{
    assert.deepEqual(schemaReference(await readSyrveSchemaPreflight(source)),SYRVE_SCHEMA_REFERENCE);
    assert.equal((await source.query('SELECT count(*)::int AS count FROM syrve_integrations'))[0].count,0);
    const existing=(await source.query('SELECT t.* FROM tables t JOIN table_map_identities i ON i.table_id=t.id ORDER BY t.id LIMIT 1'))[0];
    if(existing){tableId=existing.id;original=existing;await source.query("UPDATE tables SET status='free' WHERE id=$1",[tableId]);}
    else{created=true;tableId=randomUUID();await source.query("INSERT INTO tables(id,table_number,status,x,rotation,photo_url) VALUES ($1,'1','free',17,45,'/existing-activation-ci.jpg')",[tableId]);
      await source.query("INSERT INTO table_map_identities(table_id,map_key) VALUES ($1,'hall:1')",[tableId]);}
    const encrypted=integration().encrypt('synthetic-activation-ci-login');
    integrationId=(await source.query("INSERT INTO syrve_integrations(display_name,organization_id,status,api_login_encrypted,api_login_iv,api_login_auth_tag) VALUES ('Synthetic activation CI',$1,'connected',$2,$3,$4) RETURNING id",
      [org,encrypted.encrypted,encrypted.iv,encrypted.authTag]))[0].id;
    await source.query('INSERT INTO syrve_table_links(integration_id,organization_id,molo_table_id,syrve_table_id,last_known_number) VALUES ($1,$2,$3,$4,1)',[integrationId,org,tableId,provider]);
    let worker=new SyrveWorkerService(source,settings(),integration());
    assert.equal((await worker.tick()).status,'disabled');assert.equal(commands,0);assert.equal((await new SyrveStatusReadService(source).snapshot([tableId])).syncEnabled,false);
    const beforePhysical=await physical(),before=await saved(),p=await service().preview({configurationRevision:await revision()},actor);
    assert.equal(commands,0);assert.deepEqual(await saved(),before);assert.deepEqual(await physical(),beforePhysical);
    const dto={configurationRevision:p.configurationRevision,confirmationProof:p.confirmation.proof,confirmed:true};
    const race=await Promise.allSettled([caller.run(options.extra.application_name,()=>service().enable(dto,actor)),
      caller.run(other.options.extra.application_name,()=>service(other).enable(dto,actor))]);
    assert.equal(race.filter(value=>value.status==='fulfilled'&&value.value.syncEnabled).length,1,JSON.stringify({idleCaller,
      outcomes:race.map(value=>value.status==='fulfilled'?{enabled:value.value.syncEnabled,code:value.value.code}:{status:value.reason.getStatus?.(),code:value.reason.getResponse?.()?.code})}));
    assert.equal(race.find(value=>value.status==='rejected').reason.getStatus(),409);assert.equal(commands,1);
    assert.deepEqual(await physical(),beforePhysical);assert.deepEqual(await saved(),before);
    await assert.rejects(service().enable(dto,actor),error=>error.getStatus()===409);
    // Legitimate physical-number changes disable only effective consent. Public
    // map reads and a new Director preview remain available without settings edits.
    const sameRevision=await revision(),renamed=String(9_000_000+Math.floor(Math.random()*1_000_000));
    await source.query('UPDATE tables SET table_number=$2 WHERE id=$1',[tableId,renamed]);
    assert.equal((await integration().getStatus()).syncEnabled,false);assert.equal((await service().status()).configurationRevision,sameRevision);
    const changedTable=await source.getRepository(TableEntity).findOneByOrFail({id:tableId}),projection=new TableStatusProjectionService(new SyrveStatusReadService(source));
    const changedMap=await projection.captureMap([changedTable],[]);assert.equal(changedMap.syncEnabled,false);
    assert.equal(projection.physical([changedTable],changedMap)[0].status,'free');assert.equal((await worker.tick()).status,'disabled');
    assert.equal((await service().preview({configurationRevision:sameRevision},actor)).tableNumbers[0],renamed);assert.equal(commands,1);
    await source.query('UPDATE tables SET table_number=$2 WHERE id=$1',[tableId,beforePhysical[0].table_number]);
    await source.destroy();source=new DataSource(options);await source.initialize();await worker.onModuleDestroy();
    assert.equal((await integration().getStatus()).syncEnabled,true);assert.equal((await service().status()).syncEnabled,true);
    worker=new SyrveWorkerService(source,settings(),integration());
    rows=[wrapper(order,'New',100)];assert.equal((await worker.tick()).status,'observed');assert.equal((await status()).lastSyrveState,'open');
    const openedPhysical=await physical();assert.equal(openedPhysical[0].status,'occupied');
    assert.deepEqual(openedPhysical.map(row=>({...row,status:'free',updated_at:beforePhysical[0].updated_at})),beforePhysical);
    const opened=await saved();
    await due();commandError=true;assert.equal((await worker.tick()).status,'failed');assert.deepEqual(await saved(),opened);commandError=false;
    await due();commandPending=true;assert.equal((await worker.tick()).status,'failed');commandPending=false;
    assert.ok((await job()).lease_id);const pendingCommands=commands;assert.equal((await new SyrveWorkerStore(other,settings(other)).claim()).status,'busy');
    assert.equal(commands,pendingCommands);assert.deepEqual(await saved(),opened);
    await source.query("UPDATE syrve_worker_state SET lease_until=clock_timestamp()-interval '1 second' WHERE integration_id=$1",[integrationId]);
    await due();rows=[];missing=true;assert.equal((await worker.tick()).status,'failed');assert.deepEqual((await saved()).links,opened.links);missing=false;
    await due();rows=[wrapper(order,'Closed',200)];assert.equal((await worker.tick()).status,'observed');assert.deepEqual((await status()).activeSyrveOrderIds,[]);
    assert.equal((await status()).lastSyrveState,'closed');const closedPhysical=await physical();
    assert.equal(closedPhysical[0].status,'free');
    assert.deepEqual(closedPhysical.map(row=>({...row,updated_at:beforePhysical[0].updated_at})),beforePhysical);

    // Revocation while an upstream command is unresolved fences both instances.
    await due();let entered,resume;const arrival=new Promise(yes=>entered=yes),waiting=new Promise(yes=>resume=yes);
    hold=async()=>{entered();await waiting;};const late=worker.tick();await arrival;
    const atDisable=await saved(),disabled=await service(other).disable({configurationRevision:await revision()},actor);
    assert.equal(disabled.syncEnabled,false);assert.equal((await new SyrveWorkerStore(other,settings(other)).claim()).status,'disabled');
    resume();assert.equal((await late).status,'stale');hold=null;assert.deepEqual(await saved(),atDisable);
    assert.ok((await job()).lease_id);
    assert.equal((await new SyrveStatusReadService(source).snapshot([tableId])).syncEnabled,false);assert.deepEqual(await physical(),closedPhysical);
    await worker.onModuleDestroy();
    const recovery=new SyrveTableLoadingStore(other,settings(other));
    await assert.rejects(recovery.claim(await recovery.capture(await revision())),error=>error.getStatus()===409);
    // Advance only the disposable lease clock instead of waiting ninety seconds.
    await source.query("UPDATE syrve_worker_state SET lease_until=clock_timestamp()-interval '1 second' WHERE integration_id=$1",[integrationId]);

    // A final receipt-write failure rolls back consent, never the one-use claim.
    const next=await service().preview({configurationRevision:await revision()},actor);
    await source.query("CREATE FUNCTION syrve_activation_ci_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic receipt failure'; END; $$");
    // Install the fault during mocked HTTP, after the genuine schema preflight.
    // Installing it beforehand correctly makes readiness reject catalog drift.
    hold=async()=>{await other.query('CREATE TRIGGER syrve_activation_ci_fail BEFORE INSERT OR UPDATE ON syrve_sync_activation FOR EACH ROW EXECUTE FUNCTION syrve_activation_ci_fail()');trigger=true;hold=null;};
    const failed=await service().enable({configurationRevision:next.configurationRevision,confirmationProof:next.confirmation.proof,confirmed:true},actor);
    assert.equal(trigger,true);
    assert.equal(failed.syncEnabled,false);assert.equal(failed.code,'SYRVE_UNAVAILABLE');assert.notEqual(failed.configurationRevision,next.configurationRevision);
    assert.equal((await activation().read(await settings().read())).enabled,false);assert.deepEqual(await physical(),closedPhysical);assert.deepEqual(await saved(),atDisable);
    assert.ok((await job()).lease_id);assert.equal((await job()).last_success_at,null);
  }finally{
    try{
      if(trigger)await source.query('DROP TRIGGER IF EXISTS syrve_activation_ci_fail ON syrve_sync_activation');
      await source.query('DROP FUNCTION IF EXISTS syrve_activation_ci_fail()');
      if(integrationId)await source.query('DELETE FROM syrve_integrations WHERE id=$1',[integrationId]);
      if(created)await source.query('DELETE FROM tables WHERE id=$1',[tableId]);
      else if(original)await source.query('UPDATE tables SET status=$2,updated_at=$3 WHERE id=$1',[tableId,original.status,original.updated_at]);
    }finally{globalThis.fetch=previousFetch;for(const [key,value]of Object.entries(old))value===undefined?delete env[key]:env[key]=value;
      if(source.isInitialized)await source.destroy();await other.destroy();}
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)runSyrveActivationValidation()
  .then(()=>process.stdout.write('Syrve activation, confirmed runtime transport, revocation and PostgreSQL validation passed.\n'))
  .catch(error=>{console.error(`Syrve activation validation failed: ${error.message}`);process.exitCode=1;});
