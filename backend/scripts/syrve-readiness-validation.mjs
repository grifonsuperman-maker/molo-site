import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {assertFreshSchemaReferenceTarget} from './fresh-schema-reference.mjs';

export async function runSyrveReadinessValidation(env=process.env){
  assertFreshSchemaReferenceTarget(env);
  if(env!==process.env)throw new Error('Readiness validation must use the validated process environment.');
  const require=createRequire(import.meta.url),{DataSource}=require('typeorm');
  const {readSyrveSchemaPreflight,schemaPreflight,schemaReference}=require('../dist/syrve/syrve-schema-preflight.js');
  const {SYRVE_SCHEMA_REFERENCE,SYRVE_SCHEMA_STEPS}=require('../dist/syrve/syrve-schema-contract.js');
  const {readinessResponse}=require('../dist/syrve/syrve-readiness.service.js');
  const {SyrveSettingsStore}=require('../dist/syrve/syrve-settings.store.js');
  const {SyrveStateStore}=require('../dist/syrve/syrve-state.store.js');
  const {row,probe,id}=require('../test/helpers/syrve-state-fixtures.js');
  const options={type:'postgres',host:env.DB_HOST,port:Number(env.DB_PORT || 5432),username:env.DB_USER || 'postgres',
    password:env.DB_PASSWORD || 'postgres',database:env.DB_NAME,synchronize:false,
    entities:[fileURLToPath(new URL('../dist/**/*.entity.js',import.meta.url))],
    extra:{connectionTimeoutMillis:5000,statement_timeout:10000}};
  const source=new DataSource(options);await source.initialize();
  let integrationId,created=false,tableId,zoneId,identity=false;
  const originalFetch=globalThis.fetch;globalThis.fetch=()=>assert.fail('Readiness must never contact upstream.');
  const facts=()=>readSyrveSchemaPreflight(source);
  const snapshots=async()=>{
    const result={};for(const [table,key]of [['tables','id'],['zones','id'],['bookings','id'],['table_map_identities','table_id'],
      ['syrve_integrations','id'],['syrve_table_links','id'],['syrve_table_sync_states','link_id'],['syrve_order_versions','link_id,order_id'],
      ['syrve_worker_state','integration_id'],['migrations','id']])result[table]=await source.query(`SELECT * FROM public."${table}" ORDER BY ${key}`);
    return result;
  };
  try{
    const original=await facts(),reference=schemaReference(original);
    assert.deepEqual(reference,SYRVE_SCHEMA_REFERENCE);
    assert.equal(schemaPreflight(original).status,'prepared');
    const baseline=await snapshots();
    const report=readinessResponse(await facts());assert.equal(report.activationAvailable,false);assert.equal(report.syncEnabled,false);
    assert.equal(report.checks.find(c=>c.key==='schema').status,'ok');assert.deepEqual(await snapshots(),baseline);
    let testedReadOnly=false;
    const guarded={options:source.options,transaction:(isolation,action)=>source.transaction(isolation,async manager=>{
      const query=manager.query.bind(manager);manager.query=async(sql,args)=>{
        const result=await query(sql,args);
        if(sql.startsWith('SET LOCAL statement_timeout')){
          assert.equal((await query('SHOW transaction_read_only'))[0].transaction_read_only,'on');
          assert.equal((await query('SHOW transaction_isolation'))[0].transaction_isolation,'repeatable read');
          await query('SAVEPOINT readonly_probe');
          await assert.rejects(query('UPDATE public.tables SET status=status'),error=>error.code==='25006');
          await query('ROLLBACK TO SAVEPOINT readonly_probe');testedReadOnly=true;
        }return result;
      };return action(manager);
    })};
    await readSyrveSchemaPreflight(guarded);assert.ok(testedReadOnly);assert.deepEqual(await snapshots(),baseline);

    await source.query('ALTER TABLE public.syrve_worker_state ALTER COLUMN failure_count DROP NOT NULL');
    assert.equal(schemaPreflight(await facts()).status,'requires_audit');
    await source.query('ALTER TABLE public.syrve_worker_state ALTER COLUMN failure_count SET NOT NULL');
    await source.query('CREATE INDEX syrve_readiness_ci_extra ON public.syrve_order_versions(order_id)');
    assert.equal(schemaPreflight(await facts()).status,'requires_audit');await source.query('DROP INDEX public.syrve_readiness_ci_extra');
    await source.query('ALTER TABLE public.table_map_identities DISABLE TRIGGER "TRG_table_map_identities_immutable"');
    assert.equal(schemaPreflight(await facts()).status,'requires_audit');
    await source.query('ALTER TABLE public.table_map_identities ENABLE TRIGGER "TRG_table_map_identities_immutable"');
    const migration=baseline.migrations.find(row=>row.name===SYRVE_SCHEMA_STEPS.at(-1).name);
    await source.query('DELETE FROM public.migrations WHERE id=$1',[migration.id]);
    assert.equal(schemaPreflight(await facts()).status,'requires_audit');
    await source.query('INSERT INTO public.migrations(id,"timestamp",name) VALUES ($1,$2,$3)',[migration.id,migration.timestamp,migration.name]);
    assert.equal(schemaPreflight(await facts()).status,'prepared');assert.deepEqual(await snapshots(),baseline);

    const existing=(await source.query('SELECT table_id FROM public.table_map_identities ORDER BY table_id LIMIT 1'))[0];
    if(existing)tableId=existing.table_id;
    else{
      tableId=randomUUID();zoneId=randomUUID();created=true;
      await source.query('INSERT INTO public.zones(id,name) VALUES ($1,\'Synthetic readiness CI\')',[zoneId]);
      await source.query('INSERT INTO public.tables(id,zone_id,table_number,status) VALUES ($1,$2,\'1\',\'free\')',[tableId,zoneId]);
      await source.query('INSERT INTO public.table_map_identities(table_id,map_key) VALUES ($1,\'hall:1\')',[tableId]);identity=true;
    }
    const org=randomUUID(),provider=randomUUID();
    integrationId=(await source.query('INSERT INTO public.syrve_integrations(display_name,organization_id,status,api_login_encrypted,api_login_iv,api_login_auth_tag) VALUES (\'Synthetic readiness CI\',$1,\'connected\',\'synthetic-cipher\',\'synthetic-iv\',\'synthetic-tag\') RETURNING id',[org]))[0].id;
    await source.query('INSERT INTO public.syrve_table_links(integration_id,organization_id,molo_table_id,syrve_table_id,last_known_number) VALUES ($1,$2,$3,$4,1)',[integrationId,org,tableId,provider]);
    let before=await snapshots(),f=await facts(),r=readinessResponse(f);assert.equal(f.data.linksValid,true);
    assert.equal(r.checks.find(c=>c.key==='connection').status,'ok');assert.equal(r.checks.find(c=>c.key==='state').status,'not_checked');
    assert.deepEqual(await snapshots(),before);assert.doesNotMatch(JSON.stringify(r),/synthetic-cipher|synthetic-iv|synthetic-tag/);
    const states=new SyrveStateStore(source,new SyrveSettingsStore(source));const capture=await states.capture(tableId);
    await states.applyObservation(capture,[{orderIds:[],probe:probe(capture.state.scope,[row(capture.state.scope,id(10))])}]);
    before=await snapshots();assert.equal((await facts()).data.state,'valid');assert.deepEqual(await snapshots(),before);
    const version=(await source.query('SELECT * FROM public.syrve_order_versions WHERE order_id=$1',[id(10)]))[0];
    await source.query('DELETE FROM public.syrve_order_versions WHERE order_id=$1',[id(10)]);
    before=await snapshots();assert.equal((await facts()).data.state,'invalid');assert.deepEqual(await snapshots(),before);
    await source.query('INSERT INTO public.syrve_order_versions(link_id,order_id,"timestamp",state,fingerprint) VALUES ($1,$2,$3,$4,$5)',[version.link_id,version.order_id,version.timestamp,version.state,version.fingerprint]);
    await source.query('UPDATE public.syrve_integrations SET configuration_revision=uuid_generate_v4() WHERE id=$1',[integrationId]);
    before=await snapshots();assert.equal((await facts()).data.state,'stale');assert.deepEqual(await snapshots(),before);
    await source.query('UPDATE public.syrve_integrations SET status=\'not_connected\' WHERE id=$1',[integrationId]);
    assert.equal(readinessResponse(await facts()).checks.find(c=>c.key==='connection').status,'blocked');
    await source.query('DELETE FROM public.syrve_integrations WHERE id=$1',[integrationId]);integrationId=null;
    if(created){await source.query('DELETE FROM public.tables WHERE id=$1',[tableId]);await source.query('DELETE FROM public.zones WHERE id=$1',[zoneId]);created=false;identity=false;}
    assert.deepEqual(await snapshots(),baseline);

    const migrations=SYRVE_SCHEMA_STEPS.map(({name})=>{const [,prefix,timestamp]=name.match(/^(.*?)(\d{13})$/);return require(`../dist/migrations/${timestamp}-${prefix}.js`)[name];});
    const migrator=new DataSource({...options,migrations});await migrator.initialize();
    try{
      for(let i=0;i<migrations.length;i++)await migrator.undoLastMigration({transaction:'all'});
      const pending=schemaPreflight(await facts());assert.equal(pending.status,'plan_requires_review');
      assert.deepEqual(pending.pending,SYRVE_SCHEMA_STEPS.map(step=>step.name));
      assert.equal(pending.applicationAvailable,false);
      await migrator.runMigrations({transaction:'all'});
      assert.deepEqual(schemaReference(await facts()),SYRVE_SCHEMA_REFERENCE);
      const after=await snapshots();delete after.migrations;delete baseline.migrations;assert.deepEqual(after,baseline);
    }finally{await migrator.destroy();}
  }finally{
    try{if(integrationId)await source.query('DELETE FROM public.syrve_integrations WHERE id=$1',[integrationId]);
      if(identity && created)await source.query('DELETE FROM public.table_map_identities WHERE table_id=$1',[tableId]);
      if(created){await source.query('DELETE FROM public.tables WHERE id=$1',[tableId]);await source.query('DELETE FROM public.zones WHERE id=$1',[zoneId]);}
    }finally{globalThis.fetch=originalFetch;await source.destroy();}
  }
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  runSyrveReadinessValidation().then(()=>process.stdout.write('Syrve read-only readiness PostgreSQL validation passed.\n'))
    .catch(error=>{console.error(`Readiness validation failed: ${error.message}`);process.exitCode=1;});
}
