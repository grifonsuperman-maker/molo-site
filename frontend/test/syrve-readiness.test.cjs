const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
const React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const VERSION='d0000000-0000-4000-8000-000000000001',OTHER='d0000000-0000-4000-8000-000000000002';
function report(version=VERSION){return {configurationRevision:version,syncEnabled:false,activationAvailable:false,checkedAt:'2026-10-01T20:00:00Z',
  checks:[['schema','ok','SCHEMA_VERIFIED'],['connection','ok','CONNECTION_SAVED'],['mapping','ok','MAPPING_VALID'],
    ['state','not_checked','STATE_UNOBSERVED'],['orders','not_checked','ORDER_ACCESS_NOT_CHECKED'],
    ['visibility','not_checked','POS_VISIBILITY_NOT_VERIFIED'],['activation','blocked','ACTIVATION_NOT_AVAILABLE']]
    .map(([key,status,code])=>({key,status,code}))};}
function load(deps={}){
  const src=fs.readFileSync(path.resolve(__dirname,'../src/director/SyrveReadinessPanel.tsx'),'utf8');
  const js=ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const exports={};vm.runInNewContext(js,{exports,require:name=>name==='../api/syrve'?{syrveApi:deps.api || {}}:
    name==='react'?deps.react || React:require(name)});return exports;
}
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
function mounted(api){
  const states=[],effects=[];let index=0,cleanup,previous;
  const component=load({api,react:{useState:value=>{const position=index++;if(!(position in states))states[position]=value;
    return [states[position],value=>states[position]=typeof value==='function'?value(states[position]):value];},
    useEffect:(effect,deps)=>{if(JSON.stringify(deps)!==JSON.stringify(previous)){effects.push(effect);previous=deps;}}}}).default;
  return {states,render:version=>{index=0;const value=component({configurationRevision:version});while(effects.length){cleanup?.();cleanup=effects.shift()();}return value;},
    unmount:()=>cleanup?.()};
}
test('actual API adapter only reads the Director readiness route',async()=>{
  const source=fs.readFileSync(path.resolve(__dirname,'../src/api/syrve.ts'),'utf8');const exports={};let route;
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,
    {exports,require:()=>({api:{get:async url=>{route=url;return report();},post:()=>assert.fail('unexpected write')}})});
  assert.equal((await exports.syrveApi.getReadiness()).activationAvailable,false);assert.equal(route,'/syrve-integration/readiness');
});
test('Director readiness renders understandable Ukrainian conditions without technical migration details or activation button',()=>{
  const {validateReadiness,SyrveReadinessView}=load();const checked=validateReadiness(report());
  const html=renderToStaticMarkup(React.createElement(SyrveReadinessView,{report:checked}));
  for(const text of ['Підготовка бази','Зв’язки столів','Повнота даних каси','Відсутність даних','ще не підтверджено'])assert.ok(html.includes(text),text);
  assert.doesNotMatch(html, /[Зз]амовлен/);
  assert.doesNotMatch(html,/CREATE TABLE|syrve_worker_state|fingerprint|<button|api_login/);
});
test('malformed or inconsistent readiness never displays a positive result',()=>{
  const {validateReadiness}=load();for(const mutate of [r=>r.syncEnabled=true,r=>r.activationAvailable=true,r=>r.configurationRevision='bad',
    r=>r.checks.pop(),r=>r.checks[0].status='blocked',r=>r.checks[0].code='<script>secret</script>',
    r=>r.checks[0].key='unknown',r=>r.checks[0]=r.checks[1],r=>r.checkedAt='invalid']) {
    const r=report();mutate(r);assert.throws(()=>validateReadiness(r),/Недійсний/);
  }
});
test('closing during readiness loading discards a late response',async()=>{
  const request=deferred(),h=mounted({getReadiness:()=>request.promise});h.render(VERSION);h.unmount();
  request.resolve(report());await flush();assert.equal(h.states[1],null);
});
test('changing configuration discards old readiness while a new snapshot is being read',async()=>{
  const first=deferred(),second=deferred();let count=0;
  const h=mounted({getReadiness:()=>++count===1?first.promise:second.promise});h.render(VERSION);h.render(OTHER);
  first.resolve(report());await flush();assert.equal(h.states[1],null);assert.equal(h.states[2],true);
  second.resolve(report(OTHER));await flush();assert.equal(h.states[1].configurationRevision,OTHER);assert.equal(h.states[2],false);
});
test('a newer server configuration cannot be presented as readiness for the older saved settings',async()=>{
  const h=mounted({getReadiness:async()=>report(OTHER)});h.render(VERSION);await flush();
  assert.equal(h.states[1],null);assert.equal(h.states[3],true);
});
test('a saved positive report is hidden immediately when configuration changes, before the new effect runs',async()=>{
  const next=deferred();let count=0;
  const h=mounted({getReadiness:()=>++count===1?Promise.resolve(report()):next.promise});
  h.render(VERSION);await flush();assert.ok(h.states[1]);
  const html=renderToStaticMarkup(h.render(OTHER));
  assert.doesNotMatch(html,/Структуру бази та історію підготовки підтверджено/);
  assert.equal(h.states[1],null);h.unmount();
});
test('network failure clears old readiness and shows only a fixed message',async()=>{
  let failed=false;const h=mounted({getReadiness:async()=>{if(failed)throw new Error('secret-driver-message');return report();}});
  h.render(VERSION);await flush();assert.ok(h.states[1]);failed=true;h.states[0]++;h.render(VERSION);await flush();
  assert.equal(h.states[1],null);assert.equal(h.states[3],true);
  const html=renderToStaticMarkup(h.render(VERSION));assert.doesNotMatch(html,/secret-driver-message/);assert.match(html,/Перевірку не завершено/);
});
