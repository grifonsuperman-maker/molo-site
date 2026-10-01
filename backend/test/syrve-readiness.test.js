const assert=require('node:assert/strict');
const test=require('node:test');
const {readFileSync}=require('node:fs');
const {resolve}=require('node:path');
const {schemaPreflight,schemaReference,readSyrveSchemaPreflight,preflightFingerprint}=require('../dist/syrve/syrve-schema-preflight.js');
const {SYRVE_SCHEMA_STEPS,SYRVE_EXISTING_HISTORY,SYRVE_SCHEMA_REFERENCE}=require('../dist/syrve/syrve-schema-contract.js');
const {SyrveReadinessService,readinessResponse}=require('../dist/syrve/syrve-readiness.service.js');
const history=names=>names.map((name,i)=>({id:i+1,timestamp:Number(name.match(/\d{13}$/)[0]),name}));
test('the committed PostgreSQL catalog contract contains all six frozen migration references',()=>{
  assert.deepEqual(Object.keys(SYRVE_SCHEMA_REFERENCE),SYRVE_SCHEMA_STEPS.map(step=>step.name));
  for(const value of Object.values(SYRVE_SCHEMA_REFERENCE))assert.match(value,/^[0-9a-f]{64}$/);
  assert.doesNotMatch(readFileSync(resolve(__dirname,'../scripts/syrve-readiness-validation.mjs'),'utf8'),/return 'captured'/);
});
function facts() {
  const tables=SYRVE_SCHEMA_STEPS.flatMap(step=>step.tables.map(table=>({table,kind:'r'})));
  return {tables,columns:[{table:'syrve_integrations',name:'configuration_revision',type:'uuid',notNull:true,default:'gen_random_uuid()'}],
    constraints:tables.map(({table})=>({table,name:'constraint-'+table,definition:'expected',validated:true,deferrable:false,deferred:false})),
    indexes:[{table:'syrve_integrations',name:'UQ_syrve_integrations_singleton',definition:'expected',valid:true,ready:true,unique:true,immediate:true},
      {table:'tables',name:'UQ_tables_canonical_number',definition:'expected',valid:true,ready:true,unique:true,immediate:true}],
    functions:[{name:'molo_keep_table_map_identity',definition:'expected'},{name:'molo_canonical_table_number',definition:'expected'}],
    triggers:[{table:'table_map_identities',name:'immutable',definition:'expected',enabled:'O'}],
    history:history([...SYRVE_EXISTING_HISTORY,'CreateGuestPushSubscriptions2026092000010',...SYRVE_SCHEMA_STEPS.map(step=>step.name)]),
    data:{tablesUnambiguous:true,integrationCount:1,connected:true,credentials:true,links:1,linksValid:true,
      configurationRevision:'d0000000-0000-4000-8000-000000000001',snapshot:'synthetic',workerRecords:0,state:'valid'}};
}
test('verified catalog plus exact existing/fresh migration history produces a reviewable plan, never application approval',()=>{
  const value=facts(),reference=schemaReference(value);
  for(const baseline of [false,true]) {
    if(baseline) value.history=history(['InitialSchemaBaseline2026081300000',...value.history.map(row=>row.name)]);
    const report=schemaPreflight(value,reference);assert.equal(report.status,'prepared');assert.equal(report.historyValid,true);
    assert.equal(report.applicationAvailable,false);assert.deepEqual(report.pending,[]);
  }
});
for(const mutate of [f=>f.columns[0].notNull=false,f=>f.constraints[0].validated=false,f=>f.constraints[0].definition='expected OR true',
  f=>f.indexes[0].valid=false,f=>f.indexes[0].definition='different table',f=>f.functions[0].definition='different body',
  f=>f.triggers[0].enabled='D',f=>f.tables[0].kind='v',f=>f.columns.push({table:'syrve_worker_state',name:'extra',type:'text'}),
  f=>f.history.pop(),f=>f.history.at(-1).timestamp=1,f=>f.history.at(-1).name='Unknown2026100199999',
  f=>f.history[1].id=f.history[0].id,f=>f.data.integrationCount=2,f=>f.data.tablesUnambiguous=false]) {
  test('changed types, constraints, index validity, functions, triggers, history or prerequisites require audit',()=>{
    const f=facts(),reference=schemaReference(f);mutate(f);
    assert.equal(schemaPreflight(f,reference).status,'requires_audit');
  });
}
test('partial objects and applied-but-missing objects cannot be interpreted as pending DDL',()=>{
  const f=facts(),reference=schemaReference(f);f.tables=f.tables.filter(row=>row.table!=='syrve_worker_state');
  assert.equal(schemaPreflight(f,reference).steps.at(-1).status,'drift');
  f.constraints=f.constraints.filter(row=>row.table!=='syrve_worker_state');
  assert.equal(schemaPreflight(f,reference).steps.at(-1).status,'missing');
  assert.equal(schemaPreflight(f,reference).status,'requires_audit');
});
test('legacy prepared-object-free schema produces six ordered pending steps without adopting a baseline',()=>{
  const f=facts();for(const key of ['tables','columns','constraints','indexes','functions','triggers']) f[key]=[];
  f.history=history(SYRVE_EXISTING_HISTORY);
  const result=schemaPreflight(f);assert.equal(result.status,'plan_requires_review');
  assert.deepEqual(result.pending,SYRVE_SCHEMA_STEPS.map(step=>step.name));assert.equal(result.applicationAvailable,false);
});
test('a preflight fingerprint changes when saved scope/data changes and never contains raw data',()=>{
  const f=facts(),before=preflightFingerprint(f);f.data.snapshot='different physical identity';
  assert.notEqual(preflightFingerprint(f),before);assert.match(before,/^[0-9a-f]{64}$/);
});
test('readiness projects only fixed diagnostics and retains unverified order access, visibility and activation',()=>{
  const f=facts();f.privateLogin='secret';f.data.secret='secret';
  const response=readinessResponse(f);assert.equal(response.syncEnabled,false);assert.equal(response.activationAvailable,false);
  assert.doesNotMatch(JSON.stringify(response),/secret|fingerprint|api_login|migration|order_id/);
  assert.equal(response.checks.find(c=>c.key==='orders').status,'not_checked');
  assert.equal(response.checks.find(c=>c.key==='visibility').status,'not_checked');
  assert.equal(response.checks.find(c=>c.key==='activation').status,'blocked');
});
test('catalog check uses repeatable-read/read-only and fixed catalog SELECTs, with zero HTTP or writes',async(t)=>{
  t.mock.method(globalThis,'fetch',()=>assert.fail('unexpected network'));
  const queries=[];const source={options:{type:'postgres'},transaction:async(isolation,action)=>{
    assert.equal(isolation,'REPEATABLE READ');return action({query:async sql=>{queries.push(sql);return [];}});
  }};
  const f=await readSyrveSchemaPreflight(source);assert.equal(f.data,null);
  assert.equal(queries[0],'SET TRANSACTION READ ONLY');assert.ok(queries.some(sql=>sql.includes('statement_timeout')));
  assert.ok(queries.every(sql=>/^(SET|SELECT)/.test(sql)));assert.equal(schemaPreflight(f).status,'requires_audit');
});
test('database and schema failures expose a fixed Ukrainian diagnostic rather than driver messages',async()=>{
  for(const source of [{options:{type:'postgres',schema:'other'}},{options:{type:'postgres'},transaction:async()=>{throw new Error('private-DB-URL');}}]) {
    await assert.rejects(new SyrveReadinessService(source).read(),error=>{
      assert.equal(error.getStatus(),503);assert.doesNotMatch(JSON.stringify(error.getResponse()),/private-DB-URL|other/);return true;
    });
  }
});
test('standalone target intent rejects application, missing target, drifted endpoint, TLS overrides and synchronize',async()=>{
  const {assertSyrvePreflightIntent,runSyrveSchemaPreflight}=await import('../scripts/syrve-schema-preflight.mjs');
  const env={MOLO_SYRVE_BRANCH:'test-syrve-migration',DB_SYNCHRONIZE:'false',MOLO_SYRVE_EXPECTED_HOST:'ep-fixture.neon.tech',
    MOLO_SYRVE_EXPECTED_DATABASE:'molo',DB_URL:'postgres://fixture:synthetic-password@ep-fixture.neon.tech/molo?sslmode=require'};
  const target=assertSyrvePreflightIntent('--check',env);assert.ok(!target.url.includes('sslmode'));
  assert.throws(()=>assertSyrvePreflightIntent('--apply',env),/Only --check/);
  for(const patch of [{DB_SYNCHRONIZE:'true'},{DB_SYNCHRONIZE:undefined},{MOLO_SYRVE_EXPECTED_DATABASE:'another'},
    {MOLO_SYRVE_BRANCH:'unverified'},{MOLO_SYRVE_EXPECTED_HOST:'another.neon.tech'},
    {DB_URL:env.DB_URL+'&options=unsafe'},{DB_URL:env.DB_URL.replace('require','disable')}]) {
    assert.throws(()=>assertSyrvePreflightIntent('--check',{...env,...patch}));
  }
  await assert.rejects(runSyrveSchemaPreflight('--check',env),/validated process environment/);
});
test('preflight introduces no schema migration, production registration, worker activation or entity synchronization',()=>{
  const read=p=>readFileSync(resolve(__dirname,'../src',p),'utf8');
  assert.match(read('syrve/syrve-worker.service.ts'),/private enabled\(\): boolean \{ return false; \}/);
  assert.match(read('syrve/syrve-status-read.service.ts'),/return false/);
  assert.doesNotMatch(read('app.module.ts'),/SyrveReadiness|SyrveSchema|syrve-schema/);
});
test('the destructive PostgreSQL validator rejects unverified or remote targets before connecting',async()=>{
  const {runSyrveReadinessValidation}=await import('../scripts/syrve-readiness-validation.mjs');
  for(const env of [{},{NODE_ENV:'test',FRESH_SCHEMA_REFERENCE_ALLOW:'true',DB_HOST:'remote.neon.tech',
    DB_NAME:'molo_fresh_schema_reference',DB_SYNCHRONIZE:'true'},
    {NODE_ENV:'test',FRESH_SCHEMA_REFERENCE_ALLOW:'true',DB_HOST:'127.0.0.1',DB_NAME:'production',DB_SYNCHRONIZE:'true'}]) {
    await assert.rejects(runSyrveReadinessValidation(env));
  }
});
