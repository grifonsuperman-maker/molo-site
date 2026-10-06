const assert=require('node:assert/strict');
const test=require('node:test');
const {createCipheriv}=require('node:crypto');
const {ConflictException}=require('@nestjs/common');
const {SyrveActivationService}=require('../dist/syrve/syrve-activation.service.js');
const {SyrveActivationStore}=require('../dist/syrve/syrve-activation.store.js');
const {SyrveStatusReadStore}=require('../dist/syrve/syrve-status-read.store.js');
const {SyrveWorkerStore}=require('../dist/syrve/syrve-worker.store.js');
const {SyrveWorkerRunner}=require('../dist/syrve/syrve-worker.runner.js');
const {SyrveIntegrationService}=require('../dist/syrve/syrve-integration.service.js');
const {TableStatusProjectionService}=require('../dist/tables/table-status-projection.service.js');
const {harness}=require('./helpers/syrve-state-harness.js');
const {consent}=require('./helpers/syrve-confirmed-worker.js');
const {SyrveTableLoadingService}=require('../dist/syrve/syrve-table-loading.service.js');
const {SyrveClient,SyrveClientException,isVerifiedLoadedProbe}=require('../dist/syrve/syrve-client.js');
const {syrveCredentialsKey}=require('../dist/syrve/syrve-credentials.js');
const {issueActivationProof,verifyActivationProof,activationBindings,activationPlan}=require('../dist/syrve/syrve-activation.js');
const {issueLoadingProof,loadingActor,loadingPlanFingerprint,tableLoadingPlan}=require('../dist/syrve/syrve-table-loading.js');
const {CreateSyrveActivation2026100200070:Migration}=require('../dist/migrations/2026100200070-CreateSyrveActivation.js');
const {id,row,probe}=require('./helpers/syrve-state-fixtures.js');
const ORG=id(100),TABLE=id(101),REV=id(102),NEXT=id(103),MOLO=id(104),GROUP=id(1);
const actor={sub:id(200),role:'owner',directorSessionVersion:2};
const scope={organizationId:ORG,syrveTableId:TABLE};
function fixture(t){
  const old=process.env.SYRVE_CREDENTIALS_SECRET;process.env.SYRVE_CREDENTIALS_SECRET='synthetic-activation-fixture';
  t.after(()=>old===undefined?delete process.env.SYRVE_CREDENTIALS_SECRET:process.env.SYRVE_CREDENTIALS_SECRET=old);
  const iv=Buffer.alloc(12,4),cipher=createCipheriv('aes-256-gcm',syrveCredentialsKey(),iv),encrypted=Buffer.concat([cipher.update('synthetic-login'),cipher.final()]);
  const capture={snapshot:{prepared:true,entity:{id:id(105),configurationRevision:REV,status:'connected',organizationId:ORG,apiBaseUrl:'https://api-eu.syrve.live',
    apiLoginEncrypted:encrypted.toString('base64'),apiLoginIv:iv.toString('base64'),apiLoginAuthTag:cipher.getAuthTag().toString('base64')},
    links:[{id:id(106),integrationId:id(105),organizationId:ORG,moloTableId:MOLO,syrveTableId:TABLE,activeSyrveOrderIds:[]}]},
    tables:[{id:MOLO,tableNumber:'12',status:'free'}],fingerprint:'a'.repeat(64)};
  let saved=false,available=true,commands=0,reads=0,claims=0,released=0,writeFailure=false,commandFailure=false;
  const settings={read:async()=>structuredClone(capture.snapshot)};
  const store={capture:async revision=>{if(revision!==capture.snapshot.entity.configurationRevision)throw new ConflictException();return structuredClone(capture);},
    assertCurrent:async old=>{if(old.fingerprint!==capture.fingerprint)throw new ConflictException();},
    claim:async old=>{await store.assertCurrent(old);if(claims)throw new ConflictException();claims++;capture.snapshot.entity.configurationRevision=NEXT;
      capture.fingerprint='b'.repeat(64);return {...structuredClone(capture),leaseId:id(107)};},
    guard:async old=>store.assertCurrent(old),release:async()=>released++};
  const client={probeOrders:async()=>{reads++;return probe(scope,[]);},initializeTables:async(_base,_login,_plan,controls)=>{
    commands++;await controls.beforeCommand();if(commandFailure)throw new SyrveClientException('SYRVE_COMMAND_FAILED');}};
  const activation={prepared:async()=>available,requireDisabled:async()=>{if(saved)throw new ConflictException();},
    read:async()=>({prepared:available,enabled:saved}),enable:async()=>{if(writeFailure)throw new Error('private-database-body');saved=true;},
    disable:async()=>{saved=false;capture.snapshot.entity.configurationRevision=id(108);return id(108);}};
  const service=new SyrveActivationService(activation,settings,store,new SyrveTableLoadingService(store,client),client,{read:async()=>({activationAvailable:available})});
  return {service,capture,activation,client,stats:()=>({saved,commands,reads,claims,released}),setAvailable:v=>available=v,
    failWrite:()=>writeFailure=true,failCommand:()=>commandFailure=true,dto:p=>({configurationRevision:REV,confirmationProof:p.confirmation.proof,confirmed:true})};
}
test('activation proof cannot be exchanged with a manual loading proof and expires in five minutes',()=>{
  const key=Buffer.alloc(32,8),input={revision:REV,local:'a'.repeat(64),upstream:'b'.repeat(64),actor:loadingActor(actor)},now=10000;
  const activation=issueActivationProof(key,input,now),manual=issueLoadingProof(key,input,now);
  assert.equal(verifyActivationProof(key,activation.proof,now).revision,REV);
  for(const proof of [manual.proof,activation.proof+'x',activation.proof.slice(1),undefined,'a'.repeat(1600)])assert.throws(()=>verifyActivationProof(key,proof,now));
  assert.throws(()=>verifyActivationProof(key,activation.proof,now+2400000));
});
test('preview is read-only; explicit consent is saved only after confirmed commands and a complete fresh read',async t=>{
  const h=fixture(t),tables=structuredClone(h.capture.tables),p=await h.service.preview({configurationRevision:REV},actor);
  assert.equal(h.stats().commands,0);assert.equal(p.syncEnabled,false);
  const value=await h.service.enable(h.dto(p),actor);
  assert.equal(value.syncEnabled,true);assert.equal(value.configurationRevision,NEXT);assert.equal(value.code,null);
  assert.deepEqual(h.stats(),{saved:true,commands:1,reads:3,claims:1,released:1});assert.deepEqual(h.capture.tables,tables);
  assert.doesNotMatch(JSON.stringify([p,value]),/synthetic-login|private-database/);
  const before=h.stats();await assert.rejects(h.service.enable(h.dto(p),actor));assert.deepEqual(h.stats(),before);
  assert.equal((await h.service.disable({configurationRevision:NEXT},actor)).syncEnabled,false);
});
test('activation preview timestamps and signed expiry share one server instant',async t=>{
  const h=fixture(t),RealDate=Date;let now=RealDate.now();
  global.Date=class extends RealDate {
    constructor(...args){super(...(args.length?args:[now++]));}
    static now(){return now++;}
  };
  t.after(()=>{global.Date=RealDate;});
  const p=await h.service.preview({configurationRevision:REV},actor),issued=Date.parse(p.checkedAt);
  assert.equal(Date.parse(p.confirmation.expiresAt)-issued,2400000);
  assert.equal(verifyActivationProof(syrveCredentialsKey(),p.confirmation.proof,issued).expires,issued+2400000);
  assert.throws(()=>verifyActivationProof(syrveCredentialsKey(),p.confirmation.proof,issued+2400000));
  assert.equal(h.stats().commands,0);
});
test('missing preparation never decrypts credentials or requests Syrve',async t=>{
  const h=fixture(t);h.setAvailable(false);delete process.env.SYRVE_CREDENTIALS_SECRET;
  await assert.rejects(h.service.preview({configurationRevision:REV},actor));assert.equal(h.stats().commands,0);assert.equal(h.stats().reads,0);
});
test('actor, session, manual change, revision and confirmation are checked before consuming a preview',async t=>{
  const h=fixture(t),p=await h.service.preview({configurationRevision:REV},actor);
  for(const [who,dto]of [[{...actor,role:'admin'},h.dto(p)],[{...actor,sub:id(201)},h.dto(p)],
    [{...actor,directorSessionVersion:3},h.dto(p)],[actor,{...h.dto(p),confirmed:false}],[actor,{...h.dto(p),configurationRevision:NEXT}]])await assert.rejects(h.service.enable(dto,who));
  h.capture.fingerprint='c'.repeat(64);await assert.rejects(h.service.enable(h.dto(p),actor));
  assert.equal(h.stats().claims,0);assert.equal(h.stats().commands,0);assert.equal(h.stats().reads,1);
});
for(const failure of ['command','receipt'])test('failed '+failure+' consumes revision but never enables or releases an uncertain load',async t=>{
  const h=fixture(t),p=await h.service.preview({configurationRevision:REV},actor);failure==='command'?h.failCommand():h.failWrite();
  const result=await h.service.enable(h.dto(p),actor);assert.equal(result.syncEnabled,false);assert.equal(result.configurationRevision,NEXT);
  assert.equal(result.code,failure==='command'?'SYRVE_COMMAND_FAILED':'SYRVE_UNAVAILABLE');assert.equal(h.stats().released,0);
  assert.equal(h.stats().saved,false);await assert.rejects(h.service.enable(h.dto(p),actor));
});
test('consent binds credentials and immutable UUID/number bindings while staff statuses and ledgers stay independent',async t=>{
  const h=fixture(t),before=activationBindings(h.capture.snapshot,h.capture.tables);
  h.capture.tables[0].status='occupied';h.capture.tables[0].updatedAt=new Date();h.capture.snapshot.links[0].activeSyrveOrderIds=[id(300)];
  assert.equal(activationBindings(h.capture.snapshot,h.capture.tables),before);
  h.capture.snapshot.links[0].syrveTableId=id(301);assert.notEqual(activationBindings(h.capture.snapshot,h.capture.tables),before);
  const plan=tableLoadingPlan(probe(scope,[]),[TABLE]);assert.throws(()=>activationPlan(plan,h.capture.snapshot));
});
for(const change of ['rename','delete','invalid-plan'])test('stale '+change+' consent keeps manual map/status reads and recovery available',async()=>{
  const h=harness();Object.assign(h.entity,{apiLoginEncrypted:'synthetic',apiLoginIv:'synthetic',apiLoginAuthTag:'synthetic'});consent(h);
  const store=new SyrveActivationStore(h.source,h.settings),revision=h.entity.configurationRevision;
  assert.equal((await store.read(h.snapshot())).enabled,true);
  await assert.rejects(store.requireDisabled(h.snapshot()),e=>e.getStatus()===409);
  h.mutate(db=>{db.physical.status='cleaning';if(change==='rename')db.physical.tableNumber='13';
    if(change==='delete')db.link=null;if(change==='invalid-plan')db.activation.loading_plan.groups=[];});
  assert.equal((await store.read(h.snapshot())).enabled,false);await store.requireDisabled(h.snapshot());
  const integration=new SyrveIntegrationService(h.settings,{}, {},{},store);
  const status=await integration.getStatus();assert.equal(status.syncEnabled,false);assert.equal(status.configurationRevision,revision);
  h.source.transaction=(_level,action)=>h.settings.localTransaction(action);
  const read=new SyrveStatusReadStore(h.source,h.settings),projection=new TableStatusProjectionService({snapshot:ids=>read.read(ids)}),table=h.saved().physical;
  const map=await projection.captureMap([table],[{...table.zone,tables:[table]}]);
  assert.equal(map.syncEnabled,false);assert.strictEqual(projection.physical([table],map)[0],table);assert.equal(table.status,'cleaning');
  assert.equal((await new SyrveWorkerStore(h.source,h.settings).claim()).status,'disabled');
  assert.equal(h.entity.configurationRevision,revision);assert.equal(h.saved().activation.enabled,true);
});
test('migration defaults off and refuses to erase any saved Director consent on rollback',async()=>{
  const sql=[],m=new Migration();await m.up({query:async q=>sql.push(q)});assert.match(sql[0],/DEFAULT false/);
  assert.doesNotMatch(sql[0],/UPDATE "tables"|INSERT INTO/);
  await assert.rejects(m.down({isTransactionActive:false}),/active transaction/);
  await assert.rejects(m.down({isTransactionActive:true,query:async()=>[{present:true}]}),/saved consent/);
  await m.down({isTransactionActive:true,query:async q=>{sql.push(q);return[{present:false}];}});assert.equal(sql.at(-1),'DROP TABLE "syrve_sync_activation"');
});

function transport(t,options={}){
  const oldApp=process.env.SYRVE_APP_ID,oldSecret=process.env.SYRVE_APP_CLIENT_SECRET;
  delete process.env.SYRVE_APP_ID;delete process.env.SYRVE_APP_CLIENT_SECRET;
  t.after(()=>{oldApp===undefined?delete process.env.SYRVE_APP_ID:process.env.SYRVE_APP_ID=oldApp;oldSecret===undefined?delete process.env.SYRVE_APP_CLIENT_SECRET:process.env.SYRVE_APP_CLIENT_SECRET=oldSecret;});
  const calls=[];
  t.mock.method(globalThis,'fetch',async(url,request)=>{
    const path=new URL(url).pathname,body=JSON.parse(request.body);calls.push({path,body});
    const values={
      '/api/1/access_token':{token:'synthetic-token'},'/api/1/organizations':{organizations:[{id:ORG,name:'Тест'}]},
      '/api/1/terminal_groups':{terminalGroups:[{organizationId:ORG,items:[{id:GROUP,organizationId:ORG,name:'Каса',posVersion:'7.7.1'}]}],terminalGroupsInSleep:[]},
      '/api/1/reserve/available_restaurant_sections':{restaurantSections:[{id:id(400),terminalGroupId:GROUP,name:'Зал',tables:[{id:TABLE,number:12,name:'Стіл',isDeleted:false}]}]},
      '/api/1/terminal_groups/is_alive':{correlationId:id(401),isAliveStatus:[{organizationId:ORG,terminalGroupId:GROUP,isAlive:true}]},
      '/api/1/order/by_table':{correlationId:id(402),orders:[]},'/api/1/order/by_id':{correlationId:id(403),orders:body.orderIds?.map(value=>row(scope,value,'Closed',200))||[]},
      '/api/1/order/init_by_table':{correlationId:id(404)},'/api/1/commands/status':Response.json({}, {status:410}),...options};
    const value=typeof values[path]==='function'?values[path](body):values[path];assert.ok(value,path);
    return value instanceof Response?value:Response.json(value);
  });
  const controls={deadline:Date.now()+45000,visibilityContext:REV+':'+NEXT,beforeCommand:async()=>{},loadingPlan:tableLoadingPlan(probe(scope,[]),[TABLE])};
  return {calls,controls,client:new SyrveClient(require('./helpers/syrve-test-request-limiter.js')),read:ids=>new SyrveClient(require('./helpers/syrve-test-request-limiter.js')).probeLoadedOrders('https://api-eu.syrve.live','synthetic-login',ORG,[TABLE],ids,controls)};
}
for(const complete of [true,false])test('Director activation with real synchronous transport '+(complete?'enables after fresh reads':'rejects a failed post-load read'),async t=>{
  let reads=0;
  const tx=transport(t,{'/api/1/order/by_table':()=>++reads===3&&!complete
    ?Response.json({exception:'private-provider-detail'},{status:403}):{correlationId:id(402),orders:[]}}),h=fixture(t);
  h.client.probeOrders=tx.client.probeOrders.bind(tx.client);
  h.client.initializeTables=tx.client.initializeTables.bind(tx.client);
  const before=structuredClone(h.capture.tables),p=await h.service.preview({configurationRevision:REV},actor);
  assert.equal(tx.calls.filter(c=>c.path.endsWith('init_by_table')).length,0);
  const result=await h.service.enable(h.dto(p),actor);
  assert.equal(result.syncEnabled,complete);assert.equal(h.stats().saved,complete);
  assert.equal(h.stats().released,complete?1:0);assert.equal(result.code,complete?null:'SYRVE_ACCESS_DENIED');
  assert.equal(reads,3);assert.equal(tx.calls.filter(c=>c.path.endsWith('init_by_table')).length,1);
  assert.equal(tx.calls.filter(c=>c.path.endsWith('commands/status')).length,0);
  assert.deepEqual(h.capture.tables,before);assert.doesNotMatch(JSON.stringify(result),/private-provider-detail|synthetic-login/);
});
test('only real transport completion followed by fresh full reads issues a nonserializable, context-bound receipt',async t=>{
  const h=transport(t),value=await h.read([id(300)]);
  assert.equal(isVerifiedLoadedProbe(value,h.controls.visibilityContext,ORG,TABLE),true);
  assert.equal(isVerifiedLoadedProbe(structuredClone(value),h.controls.visibilityContext,ORG,TABLE),false);
  assert.equal(isVerifiedLoadedProbe(value,'foreign-lease',ORG,TABLE),false);
  assert.ok(h.calls.findIndex(c=>c.path.endsWith('init_by_table'))<h.calls.findLastIndex(c=>c.path.endsWith('by_table')));
  assert.equal(h.calls.filter(c=>c.path.endsWith('commands/status')).length,0);
  value.byTable.push(value.byId[0]);assert.equal(isVerifiedLoadedProbe(value,h.controls.visibilityContext,ORG,TABLE),false);
});
for(const failure of ['command','partial','changed','guard','expired','budget'])test('runtime '+failure+' cannot certify table visibility',async t=>{
  const h=transport(t,failure==='command'?{'/api/1/order/init_by_table':Response.json({}, {status:500})}:failure==='partial'?{'/api/1/order/by_id':Response.json({}, {status:403})}:{});
  if(failure==='changed')h.controls.loadingPlan.groups[0].posVersion='8.0.0';
  if(failure==='guard')h.controls.beforeCommand=async()=>{throw new ConflictException();};
  if(failure==='expired')h.controls.deadline=Date.now()-1;
  if(failure==='budget')h.controls.requestBudget={remaining:3};
  await assert.rejects(h.read([id(300)]));
  if(['changed','guard','expired','budget'].includes(failure))assert.equal(h.calls.filter(c=>c.path.endsWith('init_by_table')).length,0);
});
for(const result of ['lost response','malformed response','provider error'])test('runtime loading '+result+' preserves exclusion until lease expiry',async t=>{
  const tx=transport(t,{'/api/1/order/init_by_table':result==='lost response'?()=>{throw new Error('synthetic-transport-loss');}
    :result==='malformed response'?{}:Response.json({}, {status:500})}),h=harness();
  Object.assign(h.entity,{organizationId:ORG,apiLoginEncrypted:'synthetic',apiLoginIv:'synthetic',apiLoginAuthTag:'synthetic'});
  h.mutate(db=>{db.link.organization_id=ORG;db.link.syrve_table_id=TABLE;});consent(h);
  const store=new SyrveWorkerStore(h.source,h.settings),runner=new SyrveWorkerRunner(store,(c,ids,controls)=>
    tx.client.probeLoadedOrders('https://api-eu.syrve.live','synthetic-login',ORG,[TABLE],ids,controls));
  assert.equal((await runner.run()).status,'failed');
  const lease=h.saved().worker.lease_id;assert.ok(lease);const calls=tx.calls.length;
  h.advance(15001);assert.equal((await runner.run()).status,'busy');assert.equal(tx.calls.length,calls);
  assert.equal(h.saved().worker.lease_id,lease);h.advance(75000);
  const replacement=await store.claim();assert.equal(replacement.status,'claimed');assert.notEqual(replacement.lease.id,lease);
  await store.release(replacement.lease);
});

test('activation PostgreSQL validation refuses unapproved or remote targets before connection',async()=>{
  const {runSyrveActivationValidation}=await import('../scripts/syrve-activation-validation.mjs');
  await assert.rejects(runSyrveActivationValidation({}),/disabled/);
  await assert.rejects(runSyrveActivationValidation({FRESH_SCHEMA_REFERENCE_ALLOW:'true',DB_URL:'postgres://remote/db'}),/refuses DB_URL/);
});
