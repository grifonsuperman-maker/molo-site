const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { SyrveWorkerStore } = require('../dist/syrve/syrve-worker.store.js');
const { SyrveWorkerRunner } = require('../dist/syrve/syrve-worker.runner.js');
const { SyrveWorkerService } = require('../dist/syrve/syrve-worker.service.js');
const { SyrveIntegrationService } = require('../dist/syrve/syrve-integration.service.js');
const { SyrveClient, SyrveClientException } = require('../dist/syrve/syrve-client.js');
const { CreateSyrveWorkerState2026100100060: Migration } = require('../dist/migrations/2026100100060-CreateSyrveWorkerState.js');
const { workerBackoff, workerError } = require('../dist/syrve/syrve-worker.model.js');
const { harness } = require('./helpers/syrve-state-harness.js');
const {consent,confirmed}=require('./helpers/syrve-confirmed-worker.js');
const { id, row, probe } = require('./helpers/syrve-state-fixtures.js');

function prepared() {
  const h = harness(); Object.assign(h.entity, {apiLoginEncrypted:'synthetic',apiLoginIv:'synthetic',apiLoginAuthTag:'synthetic'});
  consent(h);
  h.worker = () => new SyrveWorkerStore(h.source,h.settings);
  h.runner = (fetch = (c,ids) => probe(c.state.scope,[row(c.state.scope,id(10))],ids)) => new SyrveWorkerRunner(h.worker(),(c,ids,controls)=>confirmed(c,ids,controls,fetch));
  h.due = () => h.advance(300_001);
  return h;
}
function deferred() { let resolve; const promise = new Promise((yes) => resolve=yes); return {promise,resolve}; }
async function observeBills(h, bills) {
  h.due();
  const result=await h.runner((c,ids)=>probe(c.state.scope,bills.map(([order,status,version])=>row(c.state.scope,order,status,version)),ids)).run();
  assert.equal(result.status,'observed');
  return h.saved();
}

test('new bill opening and final closure update only physical status regardless of manual marks',async()=>{
  for(const manual of ['free','occupied','cleaning','reserved','pending','closed']) {
    const h=prepared();h.mutate(db=>{db.physical.status=manual;db.bookings=[{id:id(200),status:'approved',tableIds:[h.table,id(201),id(202)]}];});
    const before=h.saved();
    await observeBills(h,[[id(10),'New',100]]);
    assert.equal(h.saved().physical.status,'occupied');
    h.mutate(db=>db.physical.status=manual);
    await h.store.recordStaffAction(h.table,manual==='free'?'manual_free':'status_changed');
    await observeBills(h,[[id(10),'Closed',200]]);
    const after=h.saved();assert.equal(after.physical.status,'free');
    assert.deepEqual(after.bookings,before.bookings);
    assert.deepEqual({...after.physical,status:before.physical.status,updatedAt:before.physical.updatedAt},
      {...before.physical,updatedAt:before.physical.updatedAt});
  }
});
test('same bill updates and restart keep a later manual status until a new lifecycle event',async()=>{
  const h=prepared();await observeBills(h,[[id(10),'New',100]]);
  h.mutate(db=>db.physical.status='cleaning');await h.store.recordStaffAction(h.table,'status_changed');
  const manual=h.saved().physical;
  await observeBills(h,[[id(10),'Bill',101]]);assert.deepEqual(h.saved().physical,manual);
  h.store=h.restart();
  await observeBills(h,[[id(10),'Bill',102]]);assert.deepEqual(h.saved().physical,manual);
  await observeBills(h,[[id(10),'Bill',103],[id(11),'New',100]]);assert.equal(h.saved().physical.status,'occupied');
  await observeBills(h,[[id(10),'Closed',200],[id(11),'New',101]]);assert.equal(h.saved().physical.status,'occupied');
  await observeBills(h,[[id(10),'Closed',200],[id(11),'Closed',201]]);assert.equal(h.saved().physical.status,'free');
  h.mutate(db=>db.physical.status='occupied');await h.store.recordStaffAction(h.table,'status_changed');
  const afterClose=h.saved().physical;
  await observeBills(h,[[id(10),'Closed',200],[id(11),'Closed',202]]);assert.deepEqual(h.saved().physical,afterClose);
  await observeBills(h,[[id(11),'New',203]]);assert.equal(h.saved().physical.status,'occupied');
});
test('manual free never blocks a later closure and a repeated bill never reverses manual free',async()=>{
  const h=prepared();await observeBills(h,[[id(10),'New',100]]);
  h.mutate(db=>db.physical.status='free');await h.store.recordStaffAction(h.table,'manual_free');
  const manual=h.saved().physical;
  await observeBills(h,[[id(10),'New',101]]);assert.deepEqual(h.saved().physical,manual);
  h.mutate(db=>db.physical.status='occupied');await h.store.recordStaffAction(h.table,'status_changed');
  await observeBills(h,[[id(10),'Deleted',200]]);assert.equal(h.saved().physical.status,'free');
});
test('empty initial reads, historical closure and unverified observations cannot change a manual table',async()=>{
  const h=prepared();h.mutate(db=>db.physical.status='occupied');const manual=h.saved().physical;
  await observeBills(h,[]);assert.deepEqual(h.saved().physical,manual);
  await observeBills(h,[[id(10),'Closed',200]]);assert.deepEqual(h.saved().physical,manual);
  const capture=await h.store.capture(h.table);
  await h.store.applyObservation(capture,[{orderIds:[],probe:probe(capture.state.scope,[row(capture.state.scope,id(11),'New',300)])}]);
  assert.deepEqual(h.saved().physical,manual);
});
test('physical status write failure rolls back the bill version and ledger in the same transaction',async()=>{
  const h=prepared();await h.store.capture(h.table);h.failPhysical();const before=h.saved();
  assert.equal((await h.runner().run()).status,'failed');
  const after=h.saved();
  for(const key of ['physical','link','saved','versions','bookings'])assert.deepEqual(after[key],before[key]);
});
async function paused(h) {
  const arrived=deferred(), resume=deferred();
  const runner=h.runner(async(c,ids) => {arrived.resolve(); await resume.promise; return probe(c.state.scope,[row(c.state.scope,id(10))],ids);});
  const pending=runner.run(); await arrived.promise; return {runner,pending,resume};
}
test('direct booking writes during POS HTTP fence the delayed event without a Syrve staff hook',async()=>{
  for(const manual of ['pending','reserved','free','occupied','cleaning']) {
    const h=prepared(),p=await paused(h),before=h.saved();
    h.mutate(db=>{db.physical.status=manual;db.physical.updatedAt=new Date(2_000_000);});
    assert.equal(h.saved().saved.local_revision,before.saved.local_revision);
    const current=h.saved();p.resume.resolve();
    const result=await p.pending;assert.equal(result.status,'stale');assert.equal(result.code,'SYRVE_LOCAL_STATE_CHANGED');
    for(const key of ['physical','link','saved','versions'])assert.deepEqual(h.saved()[key],current[key]);
    await observeBills(h,[[id(10),'New',100]]);assert.equal(h.saved().physical.status,'occupied');
  }
});
test('change-and-restore of physical status is fenced by its timestamp',async()=>{
  const h=prepared(),p=await paused(h);
  h.mutate(db=>{db.physical.status='reserved';db.physical.updatedAt=new Date(2_000_000);});
  h.mutate(db=>{db.physical.status='free';db.physical.updatedAt=new Date(2_000_001);});
  const current=h.saved();p.resume.resolve();assert.equal((await p.pending).code,'SYRVE_LOCAL_STATE_CHANGED');
  assert.deepEqual(h.saved().physical,current.physical);assert.deepEqual(h.saved().versions,current.versions);
});

test('saved credentials and an environment flag cannot activate a scheduler without consent', async(t)=>{
  const h=prepared();h.mutate(db=>db.activation=null);
  t.mock.method(globalThis,'fetch',()=>assert.fail('unexpected HTTP'));
  const old=process.env.SYRVE_SYNC_ENABLED;process.env.SYRVE_SYNC_ENABLED='true';
  t.after(()=>old===undefined?delete process.env.SYRVE_SYNC_ENABLED:process.env.SYRVE_SYNC_ENABLED=old);
  const service=new SyrveWorkerService(h.source,h.settings,{probeWorkerOrders:()=>assert.fail('unexpected probe')});
  for(let i=0;i<3;i++)assert.deepEqual(await service.tick(),{status:'disabled',processed:0});
  assert.equal(h.saved().worker,null);await service.onModuleDestroy();assert.equal((await service.tick()).status,'disabled');
});

test('Nest resolves the scheduler through the actual provider dependencies without a startup read',async()=>{
  const {Test}=require('@nestjs/testing');const {DataSource}=require('typeorm');
  const {SyrveSettingsStore}=require('../dist/syrve/syrve-settings.store.js');
  const forbidden=()=>assert.fail('startup side effect');
  const module=await Test.createTestingModule({providers:[SyrveWorkerService,
    {provide:DataSource,useValue:{options:{type:'postgres'},query:forbidden,transaction:forbidden}},
    {provide:SyrveSettingsStore,useValue:{read:forbidden}},
    {provide:SyrveIntegrationService,useValue:{probeWorkerOrders:forbidden}}]}).compile();
  await module.init();await module.close();assert.equal((await module.get(SyrveWorkerService).tick()).status,'disabled');
});

test('worker bridge uses existing AES-GCM credentials only after exact saved scope validation',async(t)=>{
  const h=prepared();const old=process.env.SYRVE_CREDENTIALS_SECRET;
  process.env.SYRVE_CREDENTIALS_SECRET='synthetic-worker-bridge-key';
  t.after(()=>old===undefined ? delete process.env.SYRVE_CREDENTIALS_SECRET : process.env.SYRVE_CREDENTIALS_SECRET=old);
  const calls=[];const service=new SyrveIntegrationService(h.settings,{}, {probeLoadedOrders:async(...args)=>{calls.push(args);return {checked:true};}},{},{read:async()=>({enabled:true})});
  const encrypted=service.encrypt('synthetic-login');Object.assign(h.entity,{apiBaseUrl:'https://api-eu.syrve.live',
    apiLoginEncrypted:encrypted.encrypted,apiLoginIv:encrypted.iv,apiLoginAuthTag:encrypted.authTag});
  const c=await h.store.capture(h.table),controls={deadline:Date.now()+500,signal:new AbortController().signal};
  assert.deepEqual(await service.probeWorkerOrders(c,[id(10)],controls),{checked:true});
  assert.deepEqual(calls[0],['https://api-eu.syrve.live','synthetic-login',h.entity.organizationId,[c.state.scope.syrveTableId],[id(10)],controls]);
  const response=await service.getStatus();assert.equal(response.syncEnabled,true);
  assert.doesNotMatch(JSON.stringify(response),/synthetic-login|synthetic-worker-bridge-key/);
  h.entity.configurationRevision=randomUUID();delete process.env.SYRVE_CREDENTIALS_SECRET;
  await assert.rejects(service.probeWorkerOrders(c,[],controls),e=>e.getStatus()===409);assert.equal(calls.length,1);
});

for(const change of [(h)=>h.unprepare(),(h)=>h.unprepareSettings(),(h)=>h.entity.status='disconnected',
  (h)=>h.entity.apiLoginEncrypted=null,(h)=>h.mutate(db=>db.link=null)]) {
  test('missing preparation, connection, credentials or links cannot create a lease or call upstream',async()=>{
    const h=prepared(); change(h);
    assert.ok(['disabled','idle','failed'].includes((await h.runner(()=>assert.fail('unexpected probe')).run()).status));
    assert.equal(h.saved().worker,null);
  });
}

test('overlap in one runner and a restarted second runner has only one lease owner',async()=>{
  const h=prepared(), p=await paused(h);
  assert.equal((await p.runner.run()).status,'busy');
  assert.equal((await h.runner(()=>assert.fail('second probe')).run()).status,'busy');
  p.resume.resolve(); assert.deepEqual(await p.pending,{status:'observed',processed:1});
  assert.equal(h.saved().worker.lease_id,null);
  assert.equal((await h.runner(()=>assert.fail('backoff ignored')).run()).status,'backoff');
  h.due(); assert.equal((await h.runner().run()).status,'observed');
  assert.deepEqual(h.saved().link.active_syrve_order_ids,[id(10)]);
});

test('a real staff suppression committed during HTTP rejects the delayed response',async()=>{
  const h=prepared(); await h.runner().run(); h.due(); const p=await paused(h);
  await h.store.recordStaffAction(h.table,'manual_free'); const before=h.saved();
  p.resume.resolve(); const result=await p.pending;
  assert.equal(result.status,'stale'); assert.equal(result.code,'SYRVE_LOCAL_STATE_CHANGED');
  assert.deepEqual(h.saved().link,before.link); assert.deepEqual(h.saved().versions,before.versions);
  assert.deepEqual(h.saved().saved,before.saved);
  assert.equal(h.saved().worker.last_success_at,before.worker.last_success_at);
});

for(const change of [(h)=>h.entity.configurationRevision=randomUUID(),(h)=>h.entity.organizationId=randomUUID(),
  (h)=>h.entity.status='disconnected',(h)=>h.mutate(db=>db.link.syrve_table_id=randomUUID())]) {
  test('reconfiguration, disconnect and relinking fence delayed writes and preserve old observations',async()=>{
    const h=prepared(), p=await paused(h); change(h); const before=h.saved();
    p.resume.resolve(); const result=await p.pending;
    assert.equal(result.status,'stale'); assert.deepEqual(h.saved().link,before.link);
    assert.deepEqual(h.saved().versions,before.versions); assert.deepEqual(h.saved().saved,before.saved);
    assert.equal(h.saved().worker.last_success_at,null);
  });
}

test('a changed configuration does not start a second lease until the first exits',async()=>{
  const h=prepared(), p=await paused(h); h.entity.configurationRevision=randomUUID();
  assert.equal((await h.worker().claim()).status,'disabled'); p.resume.resolve(); await p.pending;
  consent(h);const current=await h.worker().claim(); assert.equal(current.status,'claimed');
  assert.equal(current.lease.version.revision,h.entity.configurationRevision);
  assert.equal(h.saved().worker.failure_count,0); await h.worker().release(current.lease);
});

test('expired old lease cannot apply, record a failure, or clear a new owner lease',async()=>{
  const h=prepared(), old=(await h.worker().claim()).lease, c=await h.store.capture(h.table);
  h.advance(90_001); const next=(await h.worker().claim()).lease;
  await assert.rejects(h.worker().apply(old,c,[{orderIds:[],probe:probe(c.state.scope,[row(c.state.scope,id(10))])}]), e=>e.getStatus()===409);
  await assert.rejects(h.worker().failure(old,c.linkId,'SYRVE_TIMEOUT'),e=>e.getStatus()===409);
  await h.worker().release(old); assert.equal(h.saved().worker.lease_id,next.id);
  assert.deepEqual(h.saved().versions,[]); await h.worker().release(next);
});

for(const code of ['SYRVE_AUTH_FAILED','SYRVE_ACCESS_DENIED','SYRVE_RATE_LIMITED','SYRVE_TIMEOUT',
  'SYRVE_UNAVAILABLE','SYRVE_INVALID_RESPONSE','SYRVE_OBSERVATION_LIMIT']) {
  test(`${code} retains last good state and durable backoff across restart`,async()=>{
    const h=prepared(); await h.runner().run(); h.due(); const before=h.saved();
    const result=await h.runner(()=>{throw new SyrveClientException(code);}).run();
    assert.equal(result.status,'failed'); assert.equal(result.code,code);
    assert.deepEqual(h.saved().versions,before.versions); assert.deepEqual(h.saved().link,before.link);
    assert.equal(h.saved().worker.last_success_at,before.worker.last_success_at);
    assert.equal(h.saved().worker.last_error_code,code); assert.equal(h.saved().worker.failure_count,1);
    assert.equal((await h.runner(()=>assert.fail('backoff ignored')).run()).status,'backoff');
    h.due(); assert.equal((await h.runner().run()).status,'observed');
    assert.equal(h.saved().worker.failure_count,0); assert.equal(h.saved().worker.last_error_code,null);
  });
}

test('partial register outage does not escalate the shared backoff for healthy groups',async()=>{
  const integrationId=id(700),organizationId=id(701),revision=id(702);
  const links=[0,1,2].map(n=>({id:id(710+n),integrationId,organizationId,moloTableId:id(720+n),syrveTableId:id(730+n)}));
  const lease={id:id(740),version:{id:integrationId,revision},links};
  const captures=links.map(link=>({linkId:link.id,orderIds:[],state:{scope:{integrationId,configurationRevision:revision,
    organizationId,moloTableId:link.moloTableId,syrveTableId:link.syrveTableId}}}));
  const calls={apply:[],failure:[],partial:[],release:0};
  const store={claim:async()=>({status:'claimed',lease}),captureBatch:async()=>captures,
    guardBatch:async()=>({organizationId,groups:[]}),
    apply:async(_lease,captured)=>{calls.apply.push(captured.linkId);return {code:null};},
    failure:async(_lease,linkId,code)=>calls.failure.push([linkId,code]),
    partialFailure:async(_lease,linkId,code)=>calls.partial.push([linkId,code]),
    release:async()=>{calls.release++;}};
  const runner=new SyrveWorkerRunner(store,()=>assert.fail('single-table probe must not run'),async()=>[[],null,null]);
  assert.deepEqual(await runner.run(),{status:'observed',processed:1,code:'SYRVE_OBSERVATION_UNKNOWN'});
  assert.deepEqual(calls.apply,[links[0].id]);assert.deepEqual(calls.failure,[]);
  assert.deepEqual(calls.partial,[[links[1].id,'SYRVE_OBSERVATION_UNKNOWN']]);assert.equal(calls.release,1);
});

test('batch table-local stale and uncertain results do not stop later healthy tables',async()=>{
  const integrationId=id(800),organizationId=id(801),revision=id(802);
  const links=[0,1,2,3].map(n=>({id:id(810+n),integrationId,organizationId,moloTableId:id(820+n),syrveTableId:id(830+n)}));
  const lease={id:id(840),version:{id:integrationId,revision},links};
  const captures=links.map(link=>({linkId:link.id,orderIds:[],state:{scope:{integrationId,configurationRevision:revision,
    organizationId,moloTableId:link.moloTableId,syrveTableId:link.syrveTableId}}}));
  const calls={apply:[],failure:[],partial:[],release:0};let index=0;
  const codes=[null,'SYRVE_LOCAL_STATE_CHANGED','SYRVE_OBSERVATION_UNKNOWN',null];
  const store={claim:async()=>({status:'claimed',lease}),captureBatch:async()=>captures,
    guardBatch:async()=>({organizationId,groups:[]}),
    apply:async(_lease,captured)=>{calls.apply.push(captured.linkId);return {code:codes[index++]};},
    failure:async(_lease,linkId,code)=>calls.failure.push([linkId,code]),
    partialFailure:async(_lease,linkId,code)=>calls.partial.push([linkId,code]),
    release:async()=>{calls.release++;}};
  const runner=new SyrveWorkerRunner(store,()=>assert.fail('single-table probe must not run'),async()=>[[],[],[],[]]);
  assert.deepEqual(await runner.run(),{status:'observed',processed:2,code:'SYRVE_OBSERVATION_UNKNOWN'});
  assert.deepEqual(calls.apply,links.map(link=>link.id));assert.deepEqual(calls.failure,[]);
  assert.deepEqual(calls.partial,[[links[1].id,'SYRVE_LOCAL_STATE_CHANGED'],[links[2].id,'SYRVE_OBSERVATION_UNKNOWN']]);
  assert.equal(calls.release,1);
});

test('unknown/offline/missing answers preserve occupancy and manual suppression',async()=>{
  for(const variant of ['offline','missing','unknown']) {
    const h=prepared(); await h.runner().run(); await h.store.recordStaffAction(h.table,'manual_free'); h.due();
    const result=await h.runner((c,ids)=>{
      const value=probe(c.state.scope,variant==='missing'?[]:[row(c.state.scope,id(10),variant==='unknown'?'Unknown':'New',200)],ids);
      if(variant==='offline') value.availability[0].isAlive=false; return value;
    }).run();
    assert.equal(result.status,'failed'); assert.equal(result.code,variant==='offline'?'SYRVE_INVALID_RESPONSE':'SYRVE_OBSERVATION_UNKNOWN');
    assert.deepEqual(h.saved().link.active_syrve_order_ids,[id(10)]);
    assert.deepEqual(h.saved().link.manually_freed_syrve_order_ids,[id(10)]);
  }
});

test('complete freshly loaded closure clears only confirmed active IDs and suppression',async()=>{
  const h=prepared(); await h.runner().run(); await h.store.recordStaffAction(h.table,'manual_free'); h.due();
  await h.runner((c,ids)=>probe(c.state.scope,[row(c.state.scope,id(10),'Closed',200)],ids)).run();
  assert.deepEqual(h.saved().link.active_syrve_order_ids,[]);
  assert.deepEqual(h.saved().link.manually_freed_syrve_order_ids,[]);
});

test('new order can occupy after suppression, while a replay cannot undo the staff action',async()=>{
  const h=prepared(); await h.runner().run(); await h.store.recordStaffAction(h.table,'manual_free'); h.due();
  await h.runner((c,ids)=>probe(c.state.scope,[row(c.state.scope,id(10),'New',101),row(c.state.scope,id(11),'New',101)],ids)).run();
  const c=await h.store.capture(h.table);
  assert.deepEqual(c.state.manuallyFreedSyrveOrderIds,[id(10)]);
  assert.deepEqual(c.state.activeSyrveOrderIds,[id(10),id(11)]);
});

test('4201 saved orders use three complete scopes; failure in the final scope publishes no early state',async()=>{
  const h=prepared(); await h.runner().run(); h.due();
  const ids=Array.from({length:4201},(_,n)=>id(100+n));
  h.mutate(db=>{db.link.active_syrve_order_ids=ids; db.versions=ids.map(value=>({id:value,timestamp:100,state:'open',fingerprint:'b'.repeat(64)}));});
  const before=h.saved(), seen=[];
  const result=await h.runner((c,orderIds)=>{
    seen.push(orderIds); const value=probe(c.state.scope,orderIds.map(value=>row(c.state.scope,value,'Closed',200)),orderIds);
    value.byTable=[];
    if(seen.length===3) value.checks.ordersById={status:'error',code:'SYRVE_RATE_LIMITED'};
    return value;
  }).run();
  assert.deepEqual(seen.map(x=>x.length),[2000,2000,201]); assert.deepEqual(seen.flat(),ids);
  assert.equal(result.status,'failed'); assert.deepEqual(h.saved().versions,before.versions);
  assert.deepEqual(h.saved().link,before.link); assert.deepEqual(h.saved().saved,before.saved);
  h.due(); seen.length=0;
  assert.equal((await h.runner((c,orderIds)=>{seen.push(orderIds); const value=probe(c.state.scope,orderIds.map(value=>row(c.state.scope,value,'New',201)),orderIds); value.byTable=[]; return value;}).run()).status,'observed');
  assert.deepEqual(seen.flat(),ids); assert.equal(h.saved().versions.length,4201);
  assert.ok(h.saved().versions.every(v=>v.timestamp===201));
});

test('worker bookkeeping failure rolls back a successful order update in the same transaction',async()=>{
  const h=prepared(); await h.runner().run(); h.due(); const before=h.saved(); h.failWorker();
  const result=await h.runner((c,ids)=>probe(c.state.scope,[row(c.state.scope,id(10),'New',200),row(c.state.scope,id(11),'New',200)],ids)).run();
  assert.equal(result.status,'failed'); assert.deepEqual(h.saved().versions,before.versions);
  assert.deepEqual(h.saved().link,before.link); assert.deepEqual(h.saved().saved,before.saved);
  assert.equal(h.saved().worker.last_success_at,before.worker.last_success_at);
});

test('lease expiry during the final state write rolls the entire observation back',async()=>{
  const h=prepared();await h.runner().run();h.due();const before=h.saved(),native=h.manager.query;
  h.manager.query=async(sql,args)=>{
    const result=await native(sql,args);
    if(sql.startsWith('INSERT') && sql.includes('syrve_order_versions')) h.advance(90_001);
    return result;
  };
  const result=await h.runner((c,ids)=>probe(c.state.scope,[row(c.state.scope,id(10),'New',201)],ids)).run();
  assert.equal(result.status,'stale');assert.deepEqual(h.saved().versions,before.versions);
  assert.deepEqual(h.saved().link,before.link);assert.deepEqual(h.saved().saved,before.saved);
});

test('unexpected transport exceptions save only the fixed unavailable diagnostic',async()=>{
  const h=prepared(),secret='synthetic-private-api-login';
  const result=await h.runner(()=>{throw new Error(secret);}).run();
  assert.equal(result.code,'SYRVE_UNAVAILABLE');assert.equal(h.saved().worker.last_error_code,'SYRVE_UNAVAILABLE');
  assert.ok(!JSON.stringify(result).includes(secret));assert.ok(!JSON.stringify(h.saved()).includes(secret));
});

test('shutdown aborts a real Syrve fetch, waits for exit and persists no failed observations',async(t)=>{
  process.env.SYRVE_APP_ID=''; process.env.SYRVE_APP_CLIENT_SECRET='';
  const h=prepared(), arrived=deferred(), client=new SyrveClient(require('./helpers/syrve-test-request-limiter.js'));
  t.mock.method(globalThis,'fetch',async(url,{signal})=>new Promise((yes,no)=>{
    arrived.resolve(); signal.addEventListener('abort',()=>no(new DOMException('aborted','AbortError')),{once:true});
  }));
  const runner=h.runner((c,ids,controls)=>client.probeOrders('https://api-eu.syrve.live','synthetic',c.state.scope.organizationId,[c.state.scope.syrveTableId],ids,controls));
  const pending=runner.run(); await arrived.promise; await runner.stop();
  assert.equal((await pending).status,'stopped'); assert.equal((await runner.run()).status,'stopped');
  assert.deepEqual(h.saved().versions,[]); assert.equal(h.saved().worker.last_error_code,null);
  assert.equal(h.saved().worker.lease_id,null);
});

test('the shared cycle deadline covers all order scopes, retaining earlier good state',async(t)=>{
  const h=prepared(); await h.runner().run(); h.due(); const before=h.saved(); let now=1_000;
  t.mock.method(Date,'now',()=>now);
  const result=await h.runner((c,ids,controls)=>{
    assert.equal(controls.deadline,46_000); assert.ok(controls.signal instanceof AbortSignal); now=46_001;
    return probe(c.state.scope,[row(c.state.scope,id(10),'New',200)],ids);
  }).run();
  assert.equal(result.code,'SYRVE_TIMEOUT'); assert.deepEqual(h.saved().versions,before.versions);
});

test('one cycle covers all 65 linked tables and rotates the cursor after an early failure',async()=>{
  const h=prepared(); const snapshot=h.snapshot(); snapshot.links=Array.from({length:65},(_,n)=>({...snapshot.links[0],id:id(1000+n),moloTableId:id(2000+n),syrveTableId:id(3000+n)}));
  const physical=snapshot.links.map((link,n)=>({id:link.moloTableId,tableNumber:String(n+1)}));
  h.tables.find=async()=>physical;h.settings.read=async()=>snapshot;
  h.settings.transaction=(expected,action)=>h.settings.localTransaction(manager=>action(manager,snapshot));
  const {activationBindings}=require('../dist/syrve/syrve-activation.js');
  h.mutate(db=>Object.assign(db.activation,{bindings_fingerprint:activationBindings(snapshot,physical),loading_plan:{organizationId:snapshot.entity.organizationId,
    groups:[{terminalGroupId:id(1),posVersion:'7.7.1',tableIds:snapshot.links.map(link=>link.syrveTableId).sort()}]}}));
  const first=(await h.worker().claim()).lease; assert.equal(first.links.length,65);
  await h.worker().failure(first,first.links[31].id,'SYRVE_UNAVAILABLE'); await h.worker().release(first); h.due();
  const second=(await h.worker().claim()).lease; assert.equal(second.links.length,65);
  assert.equal(second.links[0].id,id(1032));
  await h.worker().failure(second,second.links[31].id,'SYRVE_UNAVAILABLE'); await h.worker().release(second); h.due();
  const third=(await h.worker().claim()).lease; assert.equal(third.links[0].id,id(1064));
  assert.equal(third.links[1].id,id(1000)); await h.worker().release(third);
});

test('backoff is bounded, rate limits wait at least a minute, raw exceptions cannot become saved diagnostics',()=>{
  assert.deepEqual([1,2,3,4,5,6,20].map(n=>workerBackoff(n,'SYRVE_UNAVAILABLE')),[15000,30000,60000,120000,240000,300000,300000]);
  assert.equal(workerBackoff(1,'SYRVE_RATE_LIMITED'),60000); assert.equal(workerError('secret upstream body'),'SYRVE_UNAVAILABLE');
});

test('worker schema rollback refuses saved leases and requires a transaction; empty storage reverses safely',async()=>{
  const migration=new Migration(), sql=[];
  await migration.up({query:async(q)=>sql.push(q)});
  assert.match(sql[0],/ON DELETE CASCADE/); assert.doesNotMatch(sql[0],/ALTER TABLE|UPDATE "tables"/);
  await assert.rejects(migration.down({isTransactionActive:false}),/requires an active transaction/);
  await assert.rejects(migration.down({isTransactionActive:true,query:async()=>[{present:true}]}),/saved worker state exists/);
  sql.length=0; await migration.down({isTransactionActive:true,query:async(q)=>{sql.push(q);return [{present:false}];}});
  assert.equal(sql.at(-1),'DROP TABLE "syrve_worker_state"');
});

test('prepared worker has no HTTP/export/activation path and migration is restricted to disposable databases',()=>{
  const read=(p)=>readFileSync(resolve(__dirname,'../src',p),'utf8');
  assert.doesNotMatch(read('syrve/syrve-integration.controller.ts'),/Worker|worker|probeWorkerOrders/);
  assert.doesNotMatch(read('syrve/syrve-integration.module.ts').split('exports:')[1],/Worker|StateStore/);
  assert.doesNotMatch(read('app.module.ts').split('const staffPinMigrationOptions = {')[1].split('};')[0],/CreateSyrveWorkerState/);
  assert.match(read('app.module.ts'),/migrations: isDisposableSchemaReference[\s\S]*CreateSyrveWorkerState/);
});

test('PostgreSQL worker validator rejects unapproved and remote databases before connection',async()=>{
  const {runSyrveWorkerValidation}=await import('../scripts/syrve-worker-validation.mjs');
  await assert.rejects(runSyrveWorkerValidation({}),/disabled/);
  await assert.rejects(runSyrveWorkerValidation({FRESH_SCHEMA_REFERENCE_ALLOW:'true',DB_URL:'postgres://remote/db'}),/refuses DB_URL/);
});
