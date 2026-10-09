require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const { createCipheriv } = require('node:crypto');
const { ConflictException } = require('@nestjs/common');
const model = require('../dist/syrve/syrve-table-loading.js');
const { issuePreviewProof } = require('../dist/syrve/syrve-preview-proof.js');
const { syrveCredentialsKey } = require('../dist/syrve/syrve-credentials.js');
const { SyrveClient, SyrveClientException } = require('../dist/syrve/syrve-client.js');
const { SyrveTableLoadingService } = require('../dist/syrve/syrve-table-loading.service.js');

const id = n => 'a0000000-0000-4000-8000-' + String(n).padStart(12, '0');
const ORG=id(1), GROUP=id(2), GROUP2=id(3), TABLE=id(10), TABLE2=id(11), REV=id(20), NEXT=id(21), CORR=id(30);
const actor = { sub:id(100), role:'owner', telegramId:'synthetic', directorSessionVersion:2 };
const flags = { syncEnabled:false, activationAvailable:false, statusesApplied:false, renamingApplied:false, complete:false };
function probe() {
  return { organizationId:ORG, checks:Object.fromEntries(['connection','terminalGroups','restaurantSections','posAvailability','ordersByTable','ordersById']
    .map(key=>[key,{status:key==='ordersById'?'not_checked':'ok',code:null}])),
    terminalGroups:{active:[{id:GROUP,posVersion:'7.7.1'}],sleeping:[]},
    catalogTables:[{id:TABLE,terminalGroupId:GROUP,isDeleted:false},{id:TABLE2,terminalGroupId:GROUP,isDeleted:false}],
    availability:[{terminalGroupId:GROUP,isAlive:true}],byTable:[],byId:null };
}
const plan = () => model.tableLoadingPlan(probe(),[TABLE,TABLE2]);
const code = expected => error => error instanceof SyrveClientException && error.getResponse().code === expected;

test('loading requires exact mapped, active, available, supported table/group evidence', () => {
  assert.deepEqual(plan(), {organizationId:ORG,groups:[{terminalGroupId:GROUP,tableIds:[TABLE,TABLE2],posVersion:'7.7.1'}]});
  const mutations = [p=>p.catalogTables.pop(),p=>p.catalogTables[0].isDeleted=true,
    p=>p.catalogTables.push({...p.catalogTables[0]}),p=>p.catalogTables[0].terminalGroupId=GROUP2,
    p=>p.terminalGroups.active[0].posVersion='7.7.0',p=>p.terminalGroups.active[0].posVersion=null,
    p=>p.terminalGroups.sleeping.push({...p.terminalGroups.active[0]}),p=>p.terminalGroups.active.push({...p.terminalGroups.active[0]}),
    p=>p.availability[0].isAlive=false,p=>p.availability=[],p=>p.availability.push({...p.availability[0]}),
    p=>p.checks={},p=>p.checks.ordersById.status='error'];
  for (const key of ['connection','terminalGroups','restaurantSections','posAvailability','ordersByTable'])
    mutations.push(p=>p.checks[key].status='not_checked',p=>p.checks[key].status='error');
  for (const mutate of mutations) { const p=probe();mutate(p);assert.throws(()=>model.tableLoadingPlan(p,[TABLE,TABLE2])); }
  for (const ids of [[],[TABLE,TABLE],['invalid'],Array.from({length:101},(_,i)=>id(i+1000))]) assert.throws(()=>model.tableLoadingPlan(probe(),ids));
});

test('an unrelated compatible register cannot validate a mapped unsupported register', () => {
  const p=probe();p.terminalGroups.active[0].posVersion='7.4.6';p.terminalGroups.active.push({id:GROUP2,posVersion:'8.0.0'});
  assert.throws(()=>model.tableLoadingPlan(p,[TABLE]));
});

test('optional missing/null version metadata permits a plan without inventing a version; malformed or unexplained values do not', () => {
  for (const status of ['missing','null']) {
    const p=probe();Object.assign(p.terminalGroups.active[0],{posVersion:null,posVersionStatus:status});
    const candidate=model.tableLoadingPlan(p,[TABLE,TABLE2]);
    assert.equal(candidate.groups[0].posVersion,null);assert.equal(candidate.groups[0].posVersionStatus,status);
    assert.notEqual(model.loadingPlanFingerprint(candidate),model.loadingPlanFingerprint(plan()));
  }
  for (const status of [undefined,'empty','invalid_type','invalid_format','valid']) {
    const p=probe();Object.assign(p.terminalGroups.active[0],{posVersion:null,posVersionStatus:status});
    assert.throws(()=>model.tableLoadingPlan(p,[TABLE,TABLE2]));
  }
});

test('loading proofs are purpose-separated, expire and bind actor/session/local/upstream/revision', () => {
  const key=Buffer.alloc(32,7),now=1000000;
  const input={revision:REV,local:'a'.repeat(64),upstream:'b'.repeat(64),actor:model.loadingActor(actor)};
  const issued=model.issueLoadingProof(key,input,now);
  assert.deepEqual(model.verifyLoadingProof(key,issued.proof,now+1),{...input,expires:now+2400000});
  for (const value of [issued.proof+'a',issued.proof.slice(1),'x.y',undefined,'a'.repeat(1600),
    issuePreviewProof(key,{version:{id:ORG,revision:REV},organizationId:ORG,fingerprint:'a'.repeat(64),credentials:'b'.repeat(64)},now).proof])
    assert.throws(()=>model.verifyLoadingProof(key,value,now));
  assert.throws(()=>model.verifyLoadingProof(Buffer.alloc(32,8),issued.proof,now));
  assert.throws(()=>model.verifyLoadingProof(key,issued.proof,now+2400000));
  assert.throws(()=>model.verifyLoadingProof(key,issued.proof,now-1));
  assert.notEqual(model.loadingActor(actor),model.loadingActor({...actor,directorSessionVersion:3}));
  assert.notEqual(model.loadingActor(actor),model.loadingActor({...actor,sub:id(101)}));
  for(const bad of [undefined,{...actor,role:'admin'},{...actor,directorSessionVersion:undefined},{...actor,directorSessionVersion:-1},{...actor,sub:''}]) assert.throws(()=>model.loadingActor(bad));
});

test('synchronous loading requires the exact documented correlation response', () => {
  assert.equal(model.parseLoadingCorrelation({correlationId:CORR.toUpperCase()}),CORR);
  for (const value of [null,[],{},{correlationId:'bad'},{correlationId:CORR+'\n'},{correlationId:CORR,token:'private'}]) assert.throws(()=>model.parseLoadingCorrelation(value));
});

function transport(t,load=body=>({correlationId:body.terminalGroupId===GROUP?CORR:id(31)})) {
  const previous=global.fetch,requests=[];
  global.fetch=async(url,options)=>{
    const path=new URL(url).pathname,body=JSON.parse(options.body);requests.push({path,body,options});
    let result=path.endsWith('/access_token')?{token:'synthetic-token'}:path==='/api/1/organizations'?{organizations:[{id:ORG,name:'Тест'}]}
      :path==='/api/1/order/init_by_table'?await load(body,requests):new Response('unsupported-request-correlation',{status:410});
    if(result instanceof Response)return result;
    return new Response(JSON.stringify(result),{status:200,headers:{'Content-Type':'application/json'}});
  };
  const oldApp=process.env.SYRVE_APP_ID,oldClient=process.env.SYRVE_APP_CLIENT_SECRET;
  delete process.env.SYRVE_APP_ID;delete process.env.SYRVE_APP_CLIENT_SECRET;
  t.after(()=>{global.fetch=previous;for(const [key,value]of [['SYRVE_APP_ID',oldApp],['SYRVE_APP_CLIENT_SECRET',oldClient]])
    value===undefined?delete process.env[key]:process.env[key]=value;});
  const run=(p=plan(),controls={})=>new SyrveClient(require('./helpers/syrve-test-request-limiter.js')).initializeTables('https://api-eu.syrve.live','synthetic-login',p,{beforeCommand:async()=>{},...controls});
  return {requests,run};
}
test('synchronous initialization succeeds without polling an unsupported command correlation',async t=>{
  const h=transport(t);let guards=0,started=0,finished=0;
  assert.deepEqual(await h.run(plan(),{beforeCommand:async()=>{guards++;},commandStarted:()=>started++,commandFinished:()=>finished++}),{completedGroups:1});
  assert.deepEqual(h.requests.map(r=>r.path),['/api/1/access_token','/api/1/organizations','/api/1/order/init_by_table']);
  assert.deepEqual(h.requests[2].body,{organizationId:ORG,terminalGroupId:GROUP,tableIds:[TABLE,TABLE2]});
  assert.equal(guards,2);assert.equal(started,1);assert.equal(finished,1);
  assert.ok(h.requests.every(r=>r.options.redirect==='error'));
});
test('loading reuses a tested session and still guards and sends the explicit POS command', async t => {
  const h = transport(t), client = new SyrveClient(require('./helpers/syrve-test-request-limiter.js'));
  await client.checkOrganizations('https://api-eu.syrve.live', 'synthetic-login');
  let guards = 0;
  assert.deepEqual(await client.initializeTables('https://api-eu.syrve.live', 'synthetic-login', plan(),
    { beforeCommand: async () => { guards++; } }), { completedGroups: 1 });
  assert.deepEqual(h.requests.map(({ path }) => path), [
    '/api/1/access_token', '/api/1/organizations', '/api/1/order/init_by_table',
  ]);
  assert.equal(guards, 2);
  assert.deepEqual(h.requests[2].body.tableIds, [TABLE, TABLE2]);
});

test('each saved register is loaded and guarded separately without extra status requests',async t=>{
  const h=transport(t),p=plan();p.groups=[{terminalGroupId:GROUP,tableIds:[TABLE],posVersion:'7.7.1'},
    {terminalGroupId:GROUP2,tableIds:[TABLE2],posVersion:'8.0.0'}];let guards=0;
  assert.deepEqual(await h.run(p,{beforeCommand:async()=>guards++}),{completedGroups:2});
  assert.deepEqual(h.requests.slice(2).map(r=>r.body),p.groups.map(g=>({organizationId:ORG,terminalGroupId:g.terminalGroupId,tableIds:g.tableIds})));
  assert.equal(guards,4);
});
for(const [name,response,expected]of [['unexpected failure body',{state:'Error',exception:'private-password',errorReason:'private-password'},'SYRVE_INVALID_RESPONSE'],
  ['ambiguous response',{correlationId:CORR,exception:'private-password'},'SYRVE_INVALID_RESPONSE'],
  ['missing correlation',{},'SYRVE_INVALID_RESPONSE'],
  ['provider failure',()=>new Response('private-password',{status:500}),'SYRVE_UNAVAILABLE'],
  ['denied',()=>new Response('private-password',{status:403}),'SYRVE_ACCESS_DENIED']])
  test(`loading ${name} stops without another initialization or raw error leaks`,async t=>{
    const h=transport(t,typeof response==='function'?response:()=>response);let error;
    try{await h.run();}catch(e){error=e;}assert.ok(code(expected)(error));assert.ok(!JSON.stringify(error.getResponse()).includes('private-password'));
    assert.equal(h.requests.filter(r=>r.path==='/api/1/commands/status').length,0);
    assert.equal(h.requests.filter(r=>r.path==='/api/1/order/init_by_table').length,1);
  });
test('a changed scope after HTTP 200 cannot finish loading or release the unresolved worker exclusion',async t=>{
  const h=transport(t);let guards=0,finished=0;
  await assert.rejects(h.run(plan(),{beforeCommand:async()=>{if(++guards===2)throw new ConflictException();},commandFinished:()=>finished++}));
  assert.equal(finished,0);assert.equal(h.requests.length,3);
});
test('a lost loading response remains uncertain without retry or completion',async t=>{
  const h=transport(t,()=>{throw new Error('private-password');});let started=0,finished=0;
  await assert.rejects(h.run(plan(),{commandStarted:()=>started++,commandFinished:()=>finished++}),code('SYRVE_UNAVAILABLE'));
  assert.equal(started,1);assert.equal(finished,0);assert.equal(h.requests.length,3);
});
test('shared request budget, deadline and changed local scope stop before an external command',async t=>{
  const h=transport(t);await assert.rejects(h.run(plan(),{requestBudget:{remaining:2}}),code('SYRVE_OBSERVATION_LIMIT'));
  assert.equal(h.requests.length,2);
  await assert.rejects(h.run(plan(),{deadline:Date.now()-1}),code('SYRVE_TIMEOUT'));assert.equal(h.requests.length,2);
  await assert.rejects(h.run(plan(),{beforeCommand:async()=>{throw new ConflictException();}}));
  assert.equal(h.requests.filter(r=>r.path==='/api/1/order/init_by_table').length,0);
});
test('invalid or expanded initialization scope is rejected before authentication',async t=>{
  const h=transport(t);
  for(const p of [null,{organizationId:ORG,groups:[]},{organizationId:ORG,groups:'invalid'},
    {...plan(),groups:[{...plan().groups[0],tableIds:[TABLE,TABLE]}]},
    {...plan(),groups:[{...plan().groups[0],posVersion:'7.4.6'}]}])await assert.rejects(h.run(p),code('SYRVE_INVALID_RESPONSE'));
  assert.equal(h.requests.length,0);
});

function service(t) {
  const previous=process.env.SYRVE_CREDENTIALS_SECRET;process.env.SYRVE_CREDENTIALS_SECRET='synthetic-loading-secret';
  t.after(()=>previous===undefined?delete process.env.SYRVE_CREDENTIALS_SECRET:process.env.SYRVE_CREDENTIALS_SECRET=previous);
  const iv=Buffer.alloc(12,5),cipher=createCipheriv('aes-256-gcm',syrveCredentialsKey(),iv);
  const encrypted=Buffer.concat([cipher.update('synthetic-loading-login'),cipher.final()]);
  const state={snapshot:{prepared:true,entity:{id:id(50),configurationRevision:REV,status:'connected',organizationId:ORG,
    apiBaseUrl:'https://api-eu.syrve.live',apiLoginEncrypted:encrypted.toString('base64'),apiLoginIv:iv.toString('base64'),apiLoginAuthTag:cipher.getAuthTag().toString('base64')},
    links:[{moloTableId:id(60),syrveTableId:TABLE,activeSyrveOrderIds:[]},{moloTableId:id(61),syrveTableId:TABLE2,activeSyrveOrderIds:[]}]},
    tables:[{id:id(60),tableNumber:'1',status:'occupied'},{id:id(61),tableNumber:'2',status:'cleaning'}],fingerprint:'a'.repeat(64)};
  let claims=0,releases=0,reads=0,commands=0,leaseHeld=false,respond=()=>probe(),execute=async()=>{};
  const store={capture:async revision=>{if(state.snapshot.entity.configurationRevision!==revision)throw new ConflictException();return structuredClone(state);},
    assertCurrent:async capture=>{if(capture.fingerprint!==state.fingerprint)throw new ConflictException();},
    claim:async capture=>{if(capture.fingerprint!==state.fingerprint||leaseHeld)throw new ConflictException();claims++;leaseHeld=true;
      state.snapshot.entity.configurationRevision=NEXT;state.fingerprint='b'.repeat(64);return {...structuredClone(state),leaseId:id(70)};},
    guard:async capture=>store.assertCurrent(capture),release:async()=>{releases++;leaseHeld=false;}};
  const client={probeOrders:async(base,login,org,tables,known,controls)=>{reads++;assert.equal(login,'synthetic-loading-login');assert.equal(org,ORG);
    assert.deepEqual(tables,[TABLE,TABLE2]);if(controls?.requestBudget)controls.requestBudget.remaining-=6;return respond(reads,known);},
    initializeTables:async(base,login,p,controls)=>{commands++;assert.equal(p.organizationId,ORG);
      assert.deepEqual(p.groups.flatMap(group=>group.tableIds),[TABLE,TABLE2]);await controls.beforeCommand();await execute(p);return {completedGroups:1};}};
  const app=new SyrveTableLoadingService(store,client);
  return {app,state,stats:()=>({claims,releases,reads,commands,leaseHeld}),respond:value=>respond=value,execute:value=>execute=value,
    dto:preview=>({configurationRevision:REV,confirmationProof:preview.confirmation.proof,confirmed:true})};
}
test('preview only reads, explicit confirmation consumes revision, verifies commands and reads again without applying table state',async t=>{
  const h=service(t),before=JSON.stringify(h.state.tables);const preview=await h.app.preview({configurationRevision:REV},actor);
  assert.equal(h.stats().commands,0);assert.equal(h.stats().claims,0);assert.deepEqual(preview.tableNumbers,['1','2']);
  const result=await h.app.load(h.dto(preview),actor);
  assert.equal(result.configurationRevision,NEXT);assert.equal(result.commandsConfirmed,true);assert.equal(result.readCompleted,true);assert.equal(result.code,null);
  for(const[key,value]of Object.entries(flags))assert.equal(result[key],value);
  assert.deepEqual(h.stats(),{claims:1,releases:1,reads:3,commands:1,leaseHeld:false});assert.equal(JSON.stringify(h.state.tables),before);
  assert.ok(!JSON.stringify([preview,result]).includes('synthetic-loading-login'));
  const calls=h.stats();await assert.rejects(h.app.load(h.dto(preview),actor));assert.deepEqual(h.stats(),calls);
});

for (const success of [true,false]) test('unreported version loading requires explicit consent and '+(success?'fresh reads':'retains failure without applying statuses'),async t=>{
  const h=service(t),before=JSON.stringify(h.state.tables);
  h.respond(()=>{const p=probe();Object.assign(p.terminalGroups.active[0],{posVersion:null,posVersionStatus:'missing'});return p;});
  h.execute(async p=>{assert.equal(p.groups[0].posVersion,null);if(!success)throw new SyrveClientException('SYRVE_ACCESS_DENIED');});
  const p=await h.app.preview({configurationRevision:REV},actor);
  assert.equal(p.versionUnreportedGroups,1);assert.equal(h.stats().commands,0);assert.equal(h.stats().claims,0);
  await assert.rejects(h.app.load({...h.dto(p),confirmed:false},actor));assert.equal(h.stats().commands,0);
  const result=await h.app.load(h.dto(p),actor);assert.equal(result.readCompleted,success);
  assert.equal(result.commandsConfirmed,success);assert.equal(result.code,success?null:'SYRVE_ACCESS_DENIED');
  assert.equal(result.syncEnabled,false);assert.equal(JSON.stringify(h.state.tables),before);
  assert.equal(h.stats().releases,success?1:0);
});
test('loading preview timestamps and signed expiry share one server instant',async t=>{
  const h=service(t),RealDate=Date;let now=RealDate.now();
  global.Date=class extends RealDate {
    constructor(...args){super(...(args.length?args:[now++]));}
    static now(){return now++;}
  };
  t.after(()=>{global.Date=RealDate;});
  const p=await h.app.preview({configurationRevision:REV},actor),issued=Date.parse(p.checkedAt);
  assert.equal(Date.parse(p.confirmation.expiresAt)-issued,2400000);
  assert.equal(model.verifyLoadingProof(syrveCredentialsKey(),p.confirmation.proof,issued).expires,issued+2400000);
  assert.throws(()=>model.verifyLoadingProof(syrveCredentialsKey(),p.confirmation.proof,issued+2400000));
  assert.equal(h.stats().commands,0);
});
test('changed actor/session, proof/revision or manual table fingerprint cannot start loading',async t=>{
  const h=service(t),preview=await h.app.preview({configurationRevision:REV},actor);
  for(const[who,dto]of [[{...actor,sub:id(101)},h.dto(preview)],[{...actor,directorSessionVersion:3},h.dto(preview)],
    [actor,{...h.dto(preview),confirmed:false}],[actor,{...h.dto(preview),configurationRevision:NEXT}],
    [actor,{...h.dto(preview),confirmationProof:preview.confirmation.proof+'a'}]])await assert.rejects(h.app.load(dto,who));
  h.state.fingerprint='c'.repeat(64);await assert.rejects(h.app.load(h.dto(preview),actor));
  assert.equal(h.stats().commands,0);assert.equal(h.stats().claims,0);assert.equal(h.stats().reads,1);
});
test('changed group membership and unsupported registers are refused before consuming the confirmation',async t=>{
  const h=service(t),preview=await h.app.preview({configurationRevision:REV},actor);
  h.respond(()=>{const p=probe();p.terminalGroups.active[0].posVersion='8.0.0';return p;});
  await assert.rejects(h.app.load(h.dto(preview),actor));assert.equal(h.stats().claims,0);
  h.respond(()=>{const p=probe();p.terminalGroups.active.push({id:GROUP2,posVersion:'7.7.1'});
    p.availability.push({terminalGroupId:GROUP2,isAlive:true});p.catalogTables[0].terminalGroupId=GROUP2;return p;});
  await assert.rejects(h.app.load(h.dto(preview),actor));assert.equal(h.stats().claims,0);
  h.respond(()=>{const p=probe();p.terminalGroups.active[0].posVersion='7.4.6';return p;});
  await assert.rejects(h.app.load(h.dto(preview),actor));assert.equal(h.stats().commands,0);
});

test('tracked state must be read explicitly and an impossible shared budget refuses the command before claim',async t=>{
  const h=service(t);h.state.snapshot.links[0].activeSyrveOrderIds=[id(90)];
  await assert.rejects(h.app.preview({configurationRevision:REV},actor),code('SYRVE_INVALID_RESPONSE'));
  h.respond(()=>{const p=probe();p.checks.ordersById.status='ok';return p;});
  const preview=await h.app.preview({configurationRevision:REV},actor);
  h.state.snapshot.links[0].activeSyrveOrderIds=Array.from({length:4201},(_,n)=>id(1000+n));
  const oversized=await h.app.preview({configurationRevision:REV},actor);
  await assert.rejects(h.app.load(h.dto(oversized),actor),code('SYRVE_OBSERVATION_LIMIT'));
  assert.equal(h.stats().claims,0);assert.equal(h.stats().commands,0);assert.ok(preview.confirmation);
});
test('accepted command failure consumes the proof, retains the bounded lease and returns only fixed diagnostics',async t=>{
  const h=service(t),preview=await h.app.preview({configurationRevision:REV},actor);
  h.execute(async()=>{throw new SyrveClientException('SYRVE_COMMAND_IN_PROGRESS');});
  const result=await h.app.load(h.dto(preview),actor);assert.equal(result.code,'SYRVE_COMMAND_IN_PROGRESS');
  assert.equal(result.commandsConfirmed,false);assert.equal(result.readCompleted,false);assert.equal(h.stats().releases,0);assert.equal(h.stats().leaseHeld,true);
  await assert.rejects(h.app.load(h.dto(preview),actor));assert.equal(h.stats().commands,1);
});
test('fresh local changes or a failed post-load read cannot produce a successful read result',async t=>{
  for(const change of ['local','transport']) {
    const h=service(t),preview=await h.app.preview({configurationRevision:REV},actor);
    if(change==='local')h.execute(async()=>{h.state.fingerprint='c'.repeat(64);});
    else h.respond(reads=>{const p=probe();if(reads===3)p.checks.ordersByTable={status:'error',code:'SYRVE_ACCESS_DENIED'};return p;});
    const result=await h.app.load(h.dto(preview),actor);assert.equal(result.commandsConfirmed,true);assert.equal(result.readCompleted,false);
    assert.equal(result.code,change==='local'?'SYRVE_CONFIGURATION_CHANGED':'SYRVE_ACCESS_DENIED');assert.equal(h.stats().releases,0);
  }
});
