import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertFreshSchemaReferenceTarget } from './fresh-schema-reference.mjs';

export async function runSyrveStaffActionsValidation(env = process.env) {
  assertFreshSchemaReferenceTarget(env);
  if (env !== process.env) throw new Error('Syrve staff validation must use process.env after safety validation.');
  const require = createRequire(import.meta.url);
  const { DataSource } = require('typeorm');
  const { TableEntity } = require('../dist/tables/entities/table.entity.js');
  const { Booking } = require('../dist/bookings/entities/booking.entity.js');
  const { Zone } = require('../dist/zones/entities/zone.entity.js');
  const { TablesService } = require('../dist/tables/tables.service.js');
  const { SyrveSettingsStore } = require('../dist/syrve/syrve-settings.store.js');
  const { SyrveStateStore } = require('../dist/syrve/syrve-state.store.js');
  const { SyrveStaffActionsService } = require('../dist/syrve/syrve-staff-actions.service.js');
  const { id, row, probe, batches } = require('../test/helpers/syrve-state-fixtures.js');
  const options = { type:'postgres', host:env.DB_HOST, port:Number(env.DB_PORT || 5432),
    username:env.DB_USER || 'postgres', password:env.DB_PASSWORD || 'postgres', database:env.DB_NAME,
    synchronize:false, entities:[resolve(dirname(fileURLToPath(import.meta.url)),'../dist/**/*.entity.js')],
    extra:{connectionTimeoutMillis:5000,statement_timeout:10000} };
  let source=new DataSource(options); await source.initialize();
  const states=()=>new SyrveStateStore(source,new SyrveSettingsStore(source));
  const tables=()=>new TablesService(source.getRepository(TableEntity),source.getRepository(Zone),source.getRepository(Booking),
    {project:async()=>({prepared:true,tables:[]})},new SyrveStaffActionsService(source,new SyrveSettingsStore(source)));
  const tableId=randomUUID(), unlinkedId=randomUUID(), organizationId=randomUUID();
  let integrationId, linkId;
  const physical=async()=> (await source.query('SELECT * FROM "tables" WHERE id=$1',[tableId]))[0];
  const saved=async()=>({physical:await physical(),
    link:(await source.query('SELECT * FROM "syrve_table_links" WHERE id=$1',[linkId]))[0],
    state:(await source.query('SELECT * FROM "syrve_table_sync_states" WHERE link_id=$1',[linkId]))[0],
    versions:await source.query('SELECT * FROM "syrve_order_versions" WHERE link_id=$1 ORDER BY order_id',[linkId]),
    bookings:await source.query('SELECT * FROM "bookings" WHERE table_id=$1 ORDER BY id',[tableId])});
  const structural=(value)=>Object.fromEntries(Object.entries(value).filter(([key])=>!['status','updated_at'].includes(key)));
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Kyiv',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  try {
    assert.equal(Number((await source.query('SELECT count(*) AS count FROM "syrve_integrations"'))[0].count),0);
    const number=String(4_000_000+Math.floor(Math.random()*1_000_000));
    await source.query('INSERT INTO "tables" (id,table_number,status,x,rotation,photo_url) VALUES ($1,$2,\'free\',17,45,\'/existing-staff-ci.jpg\'),($3,$4,\'occupied\',0,0,NULL)',
      [tableId,number,unlinkedId,String(Number(number)+1)]);
    integrationId=(await source.query('INSERT INTO "syrve_integrations" (display_name,organization_id,status) VALUES (\'Synthetic staff CI\',$1,\'connected\') RETURNING id',[organizationId]))[0].id;
    linkId=(await source.query('INSERT INTO "syrve_table_links" (integration_id,organization_id,molo_table_id,syrve_table_id,last_known_number) VALUES ($1,$2,$3,$4,1) RETURNING id',
      [integrationId,organizationId,tableId,randomUUID()]))[0].id;
    const structureBefore=structural(await physical());

    // Before the first order, even a same-status click must reject an old reply.
    let c=await states().capture(tableId);
    await tables().setWaiterStatus(tableId,'free');
    const delayed=await states().applyObservation(c,[{orderIds:[],probe:probe(c.state.scope,[row(c.state.scope,id(10))])}]);
    assert.equal(delayed.changed,false); assert.deepEqual(delayed.diagnostics,['local_revision_changed']);
    c=await states().capture(tableId);
    await states().applyObservation(c,[{orderIds:[],probe:probe(c.state.scope,[row(c.state.scope,id(10)),row(c.state.scope,id(11))])}]);

    // Every actual staff entry point rotates the persisted revision. Direct
    // status/aliases keep their existing semantics; no number is rewritten.
    for (const [method,args,status,free] of [
      ['setWaiterStatus',['occupied'],'occupied',false],['markCleaning',[],'cleaning',false],
      ['close',[],'closed',false],['open',[],'free',true],['markOccupied',[],'occupied',false],
      ['setStatus',['reserved'],'reserved',false],['markFree',[],'free',true],
      ['setStatus',['occupied'],'occupied',false],['setWaiterStatus',['free'],'free',true],
    ]) {
      c=await states().capture(tableId);
      const result=await tables()[method](tableId,...args);
      assert.equal(result.status,status); assert.equal(result.tableNumber,number);
      const next=await states().capture(tableId);
      assert.notEqual(next.state.localRevision,c.state.localRevision);
      assert.deepEqual(next.state.orderVersions,c.state.orderVersions);
      if (free) assert.deepEqual(next.state.manuallyFreedSyrveOrderIds,[id(10),id(11)]);
    }
    await assert.rejects(tables().setStatusByNumber(number,'free'),(error)=>error.getStatus()===409);
    assert.equal((await tables().markFree(unlinkedId)).status,'free');

    // Real booking queries remain in the same transaction, with exactly the
    // existing checked-in > approved > pending > free outcomes and no booking writes.
    for (const [status,checkedIn,expected] of [['approved',new Date(),'occupied'],['approved',null,'reserved'],['pending',null,'pending']]) {
      await source.query('DELETE FROM "bookings" WHERE table_id=$1',[tableId]);
      await source.query('INSERT INTO "bookings" (table_id,booking_date,booking_time,guests_count,status,source,checked_in_at) VALUES ($1,$2,\'18:00\',2,$3,\'admin_manual\',$4)',
        [tableId,today,status,checkedIn]);
      const before=(await saved()).bookings;
      assert.equal((await tables().setWaiterStatus(tableId,'free')).status,expected);
      assert.deepEqual((await saved()).bookings,before);
      assert.deepEqual((await states().capture(tableId)).state.manuallyFreedSyrveOrderIds,[id(10),id(11)]);
    }
    await source.query('DELETE FROM "bookings" WHERE table_id=$1',[tableId]);
    await tables().close(tableId); const beforeRejected=await saved();
    await assert.rejects(tables().setWaiterStatus(tableId,'occupied'),(error)=>error.getStatus()===400);
    assert.deepEqual(await saved(),beforeRejected);
    await tables().open(tableId);

    // A trigger fails after the physical row and link have been updated.
    // PostgreSQL must roll both back, not just the last state statement.
    await tables().markOccupied(tableId); const beforeFailure=await saved();
    await source.query(`CREATE FUNCTION molo_syrve_staff_ci_fail() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'synthetic staff failure'; END $$`);
    await source.query('CREATE TRIGGER staff_ci_failure BEFORE UPDATE ON "syrve_table_sync_states" FOR EACH ROW EXECUTE FUNCTION molo_syrve_staff_ci_fail()');
    await assert.rejects(tables().markFree(tableId),/synthetic staff failure/);
    assert.deepEqual(await saved(),beforeFailure);
    await source.query('DROP FUNCTION molo_syrve_staff_ci_fail() CASCADE');

    // Concurrent observations and actions use independent connections and the
    // same settings fence. Whichever observation wins, free suppresses it.
    for (const staffFirst of [true,false]) {
      c=await states().capture(tableId);
      const manual=()=>tables().markFree(tableId);
      const values=[row(c.state.scope,id(10)),row(c.state.scope,id(11)),row(c.state.scope,id(12))];
      const evidence=batches(c,values); evidence[0].probe.byTable=probe(c.state.scope,values).byTable;
      const observed=()=>states().applyObservation(c,evidence);
      await Promise.all(staffFirst?[manual(),observed()]:[observed(),manual()]);
      const current=await states().capture(tableId);
      assert.deepEqual(current.state.manuallyFreedSyrveOrderIds,current.state.activeSyrveOrderIds);
      assert.equal((await physical()).status,'free');
    }
    await tables().markFree(tableId.toUpperCase());
    const beforeRestart=await states().capture(tableId);
    await source.destroy(); source=new DataSource(options); await source.initialize();
    assert.deepEqual(await states().capture(tableId),beforeRestart);
    assert.deepEqual(structural(await physical()),structureBefore);

    // Provider errors and disconnect preserve bindings. Manual actions still
    // commit locally, including when the selected organization is cleared.
    for (const status of ['error','not_connected']) {
      c=await states().capture(tableId);
      await source.query('UPDATE "syrve_integrations" SET status=$2,organization_id=$3,configuration_revision=uuid_generate_v4() WHERE id=$1',
        [integrationId,status,status==='not_connected'?null:organizationId]);
      await tables().markOccupied(tableId); await tables().markFree(tableId);
      assert.equal((await physical()).status,'free');
      assert.deepEqual((await saved()).link.manually_freed_syrve_order_ids,c.state.activeSyrveOrderIds);
      await assert.rejects(states().applyObservation(c,[]),(error)=>error.getStatus()===409);
      await source.query('UPDATE "syrve_integrations" SET status=\'connected\',organization_id=$2,configuration_revision=uuid_generate_v4() WHERE id=$1',[integrationId,organizationId]);
    }
    assert.deepEqual(structural(await physical()),structureBefore);

    // Exercise the actual pre-adoption fallback. RENAME is guarded by the
    // disposable target check and restored in finally; it is never production SQL.
    c=await states().capture(tableId);
    const ledgerBefore=(await saved()).versions;
    await source.query('ALTER TABLE "syrve_table_sync_states" RENAME TO "syrve_staff_ci_saved_states"');
    try {
      assert.equal((await tables().markFree(tableId)).status,'free');
      assert.deepEqual((await source.query('SELECT * FROM "syrve_order_versions" WHERE link_id=$1 ORDER BY order_id',[linkId])),ledgerBefore);
    } finally { await source.query('ALTER TABLE "syrve_staff_ci_saved_states" RENAME TO "syrve_table_sync_states"'); }
    await assert.rejects(states().applyObservation(c,[]),(error)=>error.getStatus()===409);
    const recovered=await states().capture(tableId);
    assert.deepEqual(recovered.state.manuallyFreedSyrveOrderIds,recovered.state.activeSyrveOrderIds);
    assert.deepEqual((await saved()).versions,ledgerBefore);
  } finally {
    try {
      await source.query('DROP FUNCTION IF EXISTS molo_syrve_staff_ci_fail() CASCADE');
      if (integrationId) await source.query('DELETE FROM "syrve_integrations" WHERE id=$1',[integrationId]);
      await source.query('DELETE FROM "bookings" WHERE table_id=$1',[tableId]);
      await source.query('DELETE FROM "tables" WHERE id=ANY($1::uuid[])',[[tableId,unlinkedId]]);
    } finally { await source.destroy(); }
  }
}

if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  runSyrveStaffActionsValidation().then(()=>process.stdout.write('Syrve transactional staff PostgreSQL validation passed.\n'))
    .catch((error)=>{console.error(`Syrve staff validation failed: ${error.message}`);process.exitCode=1;});
}
