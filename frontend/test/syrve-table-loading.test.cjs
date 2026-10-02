const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
const React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const REV='a0000000-0000-4000-8000-000000000020',NEXT='a0000000-0000-4000-8000-000000000021',ORG='a0000000-0000-4000-8000-000000000001';
const flags={syncEnabled:false,activationAvailable:false,statusesApplied:false,renamingApplied:false,complete:false};
const scope=()=>({configurationRevision:REV,organizationId:ORG,linkedTables:2});
const preview=()=>({...scope(),checkedAt:new Date().toISOString(),terminalGroups:1,tableNumbers:['1','2'],
  confirmation:{proof:'a'.repeat(64)+'.'+'b'.repeat(43),expiresAt:new Date(Date.now()+299000).toISOString()},...flags});
const result=()=>({...scope(),requestedRevision:REV,configurationRevision:NEXT,checkedAt:new Date().toISOString(),terminalGroups:1,
  completedGroups:1,commandsConfirmed:true,readCompleted:true,code:null,...flags});
function load(deps={}) {
  const source=fs.readFileSync(path.resolve(__dirname,'../src/director/SyrveTableLoadingPanel.tsx'),'utf8');
  const exports={};vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,
    {exports,require:name=>name==='../api/syrve'?{syrveApi:deps.api||{}}:name==='react'?deps.react||React:require(name)});return exports;
}
function find(node,predicate) {
  if(!node||typeof node!=='object')return null;if(predicate(node))return node;
  for(const child of [node.props?.children].flat(Infinity)){const found=find(child,predicate);if(found)return found;}return null;
}
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
function mounted(api,callbacks={}) {
  const states=[],refs=[],effects=[];let stateIndex=0,refIndex=0,previous,cleanup,props={...scope(),connectionReady:true,busy:false,...callbacks};
  const component=load({api,react:{
    useState(value){const i=stateIndex++;if(!(i in states))states[i]=value;return[states[i],value=>states[i]=typeof value==='function'?value(states[i]):value];},
    useRef(value){const i=refIndex++;if(!(i in refs))refs[i]={current:value};return refs[i];},
    useEffect(effect,deps){if(JSON.stringify(previous)!==JSON.stringify(deps)){previous=deps;effects.push(effect);}},
  }}).default;
  const render=changes=>{props={...props,...changes};stateIndex=0;refIndex=0;const tree=component(props);while(effects.length){cleanup?.();cleanup=effects.shift()();}return tree;};
  const click=label=>{const button=find(render(),n=>n.type==='button'&&n.props.children===label);assert.ok(button,label);button.props.onClick();};
  return{states,render,click,prepare:()=>click('Підготувати завантаження'),ack:()=>find(render(),n=>n.type==='input').props.onChange({target:{checked:true}}),
    confirm:()=>click('Завантажити стан столів'),unmount:()=>cleanup?.()};
}
test('actual API adapter sends only saved revision/proof/explicit confirmation, never scope IDs',async()=>{
  const exports={},requests=[];const source=fs.readFileSync(path.resolve(__dirname,'../src/api/syrve.ts'),'utf8');
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,
    {exports,require:()=>({api:{post:async(url,payload)=>{requests.push({url,payload});}}})});
  await exports.syrveApi.previewTableLoading(REV);await exports.syrveApi.loadTables(REV,'opaque-proof');
  assert.deepEqual(JSON.parse(JSON.stringify(requests)),[{url:'/syrve-integration/table-loading-preview',payload:{configurationRevision:REV}},
    {url:'/syrve-integration/table-loading',payload:{configurationRevision:REV,confirmationProof:'opaque-proof',confirmed:true}}]);
});
test('preview and command responses reject stale scopes, positive activation flags and contradictory results',()=>{
  const {validateLoadingPreview:vp,validateLoadingResult:vr}=load();
  assert.deepEqual(JSON.parse(JSON.stringify(vp(preview(),scope()))).tableNumbers,['1','2']);assert.equal(vr(result(),scope(),1).readCompleted,true);
  const common=[r=>r.organizationId=NEXT,r=>r.linkedTables=3,r=>r.linkedTables=-1,r=>r.terminalGroups=0,r=>r.terminalGroups=5,r=>r.checkedAt='bad',
    ...Object.keys(flags).map(key=>r=>r[key]=true)];
  for(const mutate of common){const p=preview(),r=result();mutate(p);mutate(r);assert.throws(()=>vp(p,scope()));assert.throws(()=>vr(r,scope(),1));}
  for(const mutate of [r=>r.configurationRevision=NEXT,r=>r.tableNumbers=['1','1'],r=>r.tableNumbers=['private-phone','2'],r=>r.tableNumbers=['1'],
    r=>r.confirmation=null,r=>r.confirmation.proof='bad',r=>r.confirmation.expiresAt=new Date(Date.now()-1).toISOString(),
    r=>r.confirmation.expiresAt=new Date(Date.now()+400000).toISOString()]){const p=preview();mutate(p);assert.throws(()=>vp(p,scope()));}
  for(const mutate of [r=>r.configurationRevision=REV,r=>r.requestedRevision=NEXT,r=>r.completedGroups=0,r=>r.completedGroups=NaN,
    r=>r.commandsConfirmed=false,r=>r.readCompleted='true',r=>r.code='private-exception',r=>r.readCompleted=false]){const r=result();mutate(r);assert.throws(()=>vr(r,scope(),1));}
});
test('unknown upstream details are dropped from retained evidence',()=>{
  const {validateLoadingPreview:vp,validateLoadingResult:vr}=load();const p=preview(),r=result();
  p.raw='private-password';p.confirmation.apiKey='private-password';r.exception='private-password';r.orderIds=['private-password'];
  assert.ok(!JSON.stringify([vp(p,scope()),vr(r,scope(),1)]).includes('private-password'));
});
test('mounting, refreshing, and previewing never automatically submit the command',async()=>{
  let previews=0,commands=0;const h=mounted({previewTableLoading:async()=>{previews++;return preview();},loadTables:async()=>{commands++;return result();}});
  h.render();await flush();assert.equal(previews,0);assert.equal(commands,0);
  h.prepare();await flush();assert.equal(previews,1);assert.equal(commands,0);
  const confirm=find(h.render(),n=>n.type==='button'&&n.props.children==='Завантажити стан столів');assert.equal(confirm.props.disabled,true);
  h.confirm();await flush();assert.equal(commands,0);
});
test('explicit acknowledgement submits once, clears proof and refreshes settings before unlock',async()=>{
  const command=deferred(),refresh=deferred();let commands=0,finished=0;const busy=[];
  const h=mounted({previewTableLoading:async()=>preview(),loadTables:(revision,proof)=>{assert.equal(revision,REV);assert.ok(proof);commands++;return command.promise;}},
    {onBusyChange:value=>busy.push(value),onFinished:async r=>{finished++;assert.equal(r.readCompleted,true);await refresh.promise;}});
  h.prepare();await flush();h.ack();h.confirm();
  assert.equal(h.states[0],null);assert.equal(h.states[1],false);h.prepare();assert.equal(commands,1);
  command.resolve(result());await flush();assert.equal(finished,1);assert.equal(h.states[2],true);assert.equal(busy.at(-1),true);
  refresh.resolve();await flush();assert.equal(h.states[2],false);assert.equal(busy.at(-1),false);
  const html=renderToStaticMarkup(h.render());assert.match(html,/Повторне читання столів виконано/);
  assert.doesNotMatch(html,/[Зз]амовлен|private-password|<input|000000000020|000000000001/);
});
test('double preparation clicks share a request and changed settings discard its late proof',async()=>{
  const pending=deferred();let calls=0;const h=mounted({previewTableLoading:()=>{calls++;return pending.promise;}});
  h.prepare();h.prepare();assert.equal(calls,1);h.render({configurationRevision:NEXT});pending.resolve(preview());await flush();assert.equal(h.states[0],null);
});
test('close, parent actions, draft or changed scope discard stale loading results',async()=>{
  for(const change of [null,{configurationRevision:NEXT},{organizationId:NEXT},{linkedTables:3},{busy:true},{connectionReady:false}]){
    const pending=deferred();let finished=0;const h=mounted({previewTableLoading:async()=>preview(),loadTables:()=>pending.promise},
      {onFinished:async()=>finished++});h.prepare();await flush();h.ack();h.confirm();
    change?h.render(change):h.unmount();const before=JSON.stringify(h.states);pending.resolve(result());await flush();
    assert.equal(JSON.stringify(h.states),before);assert.equal(finished,0);
  }
});
test('unprepared connection, no links or parent operation cannot prepare or submit',async()=>{
  for(const change of [{busy:true},{connectionReady:false},{linkedTables:0},{linkedTables:101},{configurationRevision:null},{organizationId:'bad'}]){
    let calls=0;const h=mounted({previewTableLoading:async()=>{calls++;return preview();}});
    const tree=h.render(change);assert.equal(find(tree,n=>n.type==='button').props.disabled,true);h.prepare();await flush();assert.equal(calls,0);
  }
});
test('expired preview cannot initialize and requires fresh confirmation',async()=>{
  let commands=0;const h=mounted({previewTableLoading:async()=>preview(),loadTables:async()=>commands++});
  h.prepare();await flush();h.states[0].confirmation.expiresAt=new Date(Date.now()-1).toISOString();h.ack();h.confirm();await flush();
  assert.equal(commands,0);assert.equal(h.states[0],null);assert.equal(h.states[1],false);assert.equal(h.states[3],true);
});
test('command failure clears confirmation, refreshes the consumed revision and never exposes raw HTTP errors',async()=>{
  let refreshed=0;const h=mounted({previewTableLoading:async()=>preview(),loadTables:async()=>{throw new Error('private-token-upstream-exception');}},
    {onFinished:async r=>{assert.equal(r,null);refreshed++;}});
  h.prepare();await flush();h.ack();h.confirm();await flush();assert.equal(refreshed,1);assert.equal(h.states[0],null);
  const html=renderToStaticMarkup(h.render());assert.match(html,/Завантаження не підтверджено/);assert.doesNotMatch(html,/private-token|<input/);
});
test('InProgress and failed post-load read never imply synchronization or free tables',async()=>{
  for(const code of ['SYRVE_COMMAND_IN_PROGRESS','SYRVE_ACCESS_DENIED']){
    const h=mounted({previewTableLoading:async()=>preview(),loadTables:async()=>({...result(),commandsConfirmed:false,completedGroups:0,readCompleted:false,code})});
    h.prepare();await flush();h.ack();h.confirm();await flush();const html=renderToStaticMarkup(h.render());
    assert.doesNotMatch(html,/Повторне читання столів виконано/);assert.match(html,/Порожня відповідь не підтверджує вільний стіл/);
    assert.match(html,/Синхронізація залишається вимкненою/);
  }
});
