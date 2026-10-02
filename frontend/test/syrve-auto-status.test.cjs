const assert=require('node:assert/strict'),test=require('node:test'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const REV='a0000000-0000-4000-8000-000000000001',NEXT='a0000000-0000-4000-8000-000000000002',ORG='a0000000-0000-4000-8000-000000000003';
const scope=()=>({configurationRevision:REV,organizationId:ORG,linkedTables:2});
const gate=()=>({configurationRevision:REV,linkedTables:2,checkedAt:new Date().toISOString(),syncEnabled:false,activationAvailable:true});
const preview=()=>({...scope(),syncEnabled:false,checkedAt:new Date().toISOString(),terminalGroups:1,tableNumbers:['1','2'],
  confirmation:{proof:'a'.repeat(64)+'.'+'b'.repeat(43),expiresAt:new Date(Date.now()+290000).toISOString()}});
const result=()=>({...scope(),requestedRevision:REV,configurationRevision:NEXT,checkedAt:new Date().toISOString(),syncEnabled:true,code:null});
function load(deps={}){
  const source=fs.readFileSync(path.resolve(__dirname,'../src/director/SyrveAutoStatusPanel.tsx'),'utf8'),exports={};
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,
    {exports,require:name=>name==='../api/syrve'?{syrveApi:deps.api||{}}:name==='react'?deps.react||React:require(name)});return exports;
}
const flush=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function find(node,predicate){if(!node||typeof node!=='object')return null;if(predicate(node))return node;
  for(const child of [node.props?.children].flat(Infinity)){const found=find(child,predicate);if(found)return found;}return null;}
function mounted(api,extra={}){
  const states=[],refs=[],effects=[];let si=0,ri=0,previous,cleanup,props={...scope(),busy:false,syncEnabled:false,onBusyChange:()=>{},onFinished:async()=>{},...extra};
  const component=load({api:{getAutoStatus:async()=>gate(),...api},react:{useState(value){const i=si++;if(!(i in states))states[i]=value;
    return[states[i],value=>states[i]=typeof value==='function'?value(states[i]):value];},useRef(value){const i=ri++;if(!(i in refs))refs[i]={current:value};return refs[i];},
    useEffect(effect,deps){if(JSON.stringify(previous)!==JSON.stringify(deps)){previous=deps;effects.push(effect);}}}}).default;
  const render=changes=>{props={...props,...changes};si=0;ri=0;const tree=component(props);while(effects.length){cleanup?.();cleanup=effects.shift()();}return tree;};
  const click=label=>{const button=find(render(),node=>node.type==='button'&&node.props.children===label);assert.ok(button,label);button.props.onClick();};
  return {states,render,ready:async()=>{render();await flush();},prepare:()=>click('Перевірити перед увімкненням'),enable:()=>click('Увімкнути автостатуси'),
    disable:()=>click('Вимкнути автостатуси'),ack:()=>find(render(),n=>n.type==='input').props.onChange({target:{checked:true}}),unmount:()=>cleanup?.()};
}
test('auto-status API sends only revision, proof and explicit confirmation',async()=>{
  const source=fs.readFileSync(path.resolve(__dirname,'../src/api/syrve.ts'),'utf8'),exports={},calls=[];
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,
    {exports,require:()=>({api:{get:async url=>calls.push({url}),post:async(url,body)=>calls.push({url,body})}})});
  await exports.syrveApi.getAutoStatus();await exports.syrveApi.previewAutoStatus(REV);await exports.syrveApi.enableAutoStatus(REV,'opaque-proof');await exports.syrveApi.disableAutoStatus(REV);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)),[{url:'/syrve-integration/auto-status'},
    {url:'/syrve-integration/auto-status-preview',body:{configurationRevision:REV}},
    {url:'/syrve-integration/enable-auto-status',body:{configurationRevision:REV,confirmationProof:'opaque-proof',confirmed:true}},
    {url:'/syrve-integration/disable-auto-status',body:{configurationRevision:REV}}]);
});
test('decoders reject stale or contradictory receipts and retain no raw details',()=>{
  const {validateAutoStatus:vg,validateActivationPreview:vp,validateActivationResult:vr}=load();
  for(const mutate of [p=>p.configurationRevision=NEXT,p=>p.organizationId=NEXT,p=>p.syncEnabled=true,p=>p.linkedTables=3,
    p=>p.tableNumbers=['1','1'],p=>p.confirmation.proof='bad',p=>p.confirmation.expiresAt=new Date(Date.now()-1).toISOString()]){const p=preview();mutate(p);assert.throws(()=>vp(p,scope()));}
  for(const mutate of [r=>r.configurationRevision=REV,r=>r.requestedRevision=NEXT,r=>r.code='private',r=>r.syncEnabled=false,r=>r.checkedAt='bad']){const r=result();mutate(r);assert.throws(()=>vr(r,scope()));}
  const p=preview(),r=result(),g=gate();p.secret='private';p.confirmation.secret='private';r.secret='private';g.secret='private';
  assert.doesNotMatch(JSON.stringify([vp(p,scope()),vr(r,scope()),vg(g,scope())]),/private/);
});
test('opening settings only reads local consent and never previews, enables or loads Syrve automatically',async()=>{
  let calls=0;const forbidden=()=>assert.fail('unrequested write');const h=mounted({getAutoStatus:async()=>{calls++;return gate();},
    previewAutoStatus:forbidden,enableAutoStatus:forbidden,disableAutoStatus:forbidden});await h.ready();h.render();assert.equal(calls,1);
});
test('enabling requires fresh preview plus acknowledgement, submits once and refreshes before unlock',async()=>{
  const command=deferred(),refresh=deferred();let calls=0,finished=0;const busy=[];
  const h=mounted({previewAutoStatus:async()=>preview(),enableAutoStatus:(rev,proof)=>{assert.equal(rev,REV);assert.ok(proof);calls++;return command.promise;}},
    {onBusyChange:value=>busy.push(value),onFinished:async value=>{assert.equal(value,'enabled');finished++;await refresh.promise;}});
  await h.ready();h.prepare();await flush();h.enable();assert.equal(calls,0);h.ack();h.enable();
  assert.equal(calls,1);assert.equal(h.states[1],null);assert.equal(h.states[2],false);h.prepare();assert.equal(calls,1);
  command.resolve(result());await flush();assert.equal(finished,1);assert.equal(h.states[3],true);assert.equal(busy.at(-1),true);
  refresh.resolve();await flush();assert.equal(h.states[3],false);assert.equal(busy.at(-1),false);
});
test('expired preview cannot enable and must be checked again',async()=>{
  let calls=0;const h=mounted({previewAutoStatus:async()=>preview(),enableAutoStatus:async()=>calls++});await h.ready();h.prepare();await flush();
  h.states[1].confirmation.expiresAt=new Date(Date.now()-1).toISOString();h.ack();h.enable();assert.equal(calls,0);assert.equal(h.states[1],null);assert.equal(h.states[4],true);
});
test('double preview clicks share one request and changed configuration discards a late proof',async()=>{
  const pending=deferred();let calls=0;const h=mounted({previewAutoStatus:()=>{calls++;return pending.promise;}});await h.ready();
  h.prepare();h.prepare();assert.equal(calls,1);h.render({configurationRevision:NEXT});pending.resolve(preview());await flush();assert.equal(h.states[1],null);
});
test('closing or changing scope during enabling cannot update the newer panel or call its refresh',async()=>{
  for(const change of [null,{configurationRevision:NEXT},{organizationId:NEXT},{linkedTables:3},{busy:true}]){
    const pending=deferred();let finished=0;const h=mounted({previewAutoStatus:async()=>preview(),enableAutoStatus:()=>pending.promise},{onFinished:async()=>finished++});
    await h.ready();h.prepare();await flush();h.ack();h.enable();change?h.render(change):h.unmount();pending.resolve(result());await flush();
    assert.equal(finished,0);assert.equal(h.states[1],null);
  }
});
test('disabling is explicit, needs no upstream access and refreshes the newly fenced revision',async()=>{
  let calls=0,finished=0;const h=mounted({getAutoStatus:async()=>({...gate(),syncEnabled:true}),disableAutoStatus:async revision=>{
    assert.equal(revision,REV);calls++;return {configurationRevision:NEXT,syncEnabled:false,checkedAt:new Date().toISOString()};}},
    {syncEnabled:true,onFinished:async value=>{assert.equal(value,'disabled');finished++;}});
  await h.ready();assert.equal(calls,0);h.disable();h.disable();await flush();assert.equal(calls,1);assert.equal(finished,1);
});
test('unknown preparation, stale local consent and other operations block all activation commands',async()=>{
  for(const extra of [{busy:true},{configurationRevision:null},{organizationId:null},{linkedTables:0}]){
    let calls=0;const h=mounted({previewAutoStatus:async()=>{calls++;return preview();}},extra);await h.ready();h.prepare();await flush();assert.equal(calls,0);
  }
});
test('transport loss clears the one-use proof, refreshes and exposes only a fixed Ukrainian message',async()=>{
  let outcome;const h=mounted({previewAutoStatus:async()=>preview(),enableAutoStatus:async()=>{throw new Error('private-api-secret');}},{onFinished:async value=>outcome=value});
  await h.ready();h.prepare();await flush();h.ack();h.enable();await flush();assert.equal(outcome,'failed');assert.equal(h.states[1],null);
  const html=renderToStaticMarkup(h.render());assert.match(html,/Операцію не підтверджено/);assert.doesNotMatch(html,/private-api-secret|000000000003|[Зз]амовлен/);
});
