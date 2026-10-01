const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { Global, Module } = require('@nestjs/common');
const { Test } = require('@nestjs/testing');
const { DataSource } = require('typeorm');
const { SyrveStaffActionsService } = require('../dist/syrve/syrve-staff-actions.service.js');
const { SyrveStaffActionsModule } = require('../dist/syrve/syrve-staff-actions.module.js');
const { TablesService } = require('../dist/tables/tables.service.js');
const { harness } = require('./helpers/syrve-state-harness.js');
const { id, row, probe, batches } = require('./helpers/syrve-state-fixtures.js');

function staff(h) {
  return new TablesService(h.tables, {}, h.bookings, { project:async () => ({prepared:false,tables:[]}) },
    new SyrveStaffActionsService(h.source,h.settings));
}
async function open(h) {
  const c = await h.store.capture(h.table);
  await h.store.applyObservation(c,[{orderIds:[],probe:probe(c.state.scope,[row(c.state.scope,id(10)),row(c.state.scope,id(11))])}]);
  h.mutate((db) => db.physical.status='occupied');
  return h.store.capture(h.table);
}
function observations(c, rows) {
  const parts=batches(c,rows);
  parts[0].probe.byTable=probe(c.state.scope,rows).byTable;
  return parts;
}

for (const [method, args, status, free] of [
  ['setWaiterStatus',['free'],'free',true], ['setStatus',['free'],'free',true],
  ['setStatusByNumber',['free'],'free',true], ['markFree',[],'free',true], ['open',[],'free',true],
  ['setWaiterStatus',['occupied'],'occupied',false], ['markOccupied',[],'occupied',false],
  ['markCleaning',[],'cleaning',false], ['close',[],'closed',false],
  ['setStatus',['reserved'],'reserved',false], ['setStatus',['pending'],'pending',false],
]) {
  test(`${method} ${args.join(' ')} commits the legacy outcome and durable staff fence together`,async () => {
    const h=harness(), before=await open(h);
    const result=await staff(h)[method](method==='setStatusByNumber'?'12':h.table,...args);
    assert.equal(result.status,status); assert.equal(result.tableNumber,'12');
    assert.deepEqual(result.zone,h.saved().physical.zone);
    const after=await h.restart().capture(h.table);
    assert.notEqual(after.state.localRevision,before.state.localRevision);
    assert.deepEqual(after.state.manuallyFreedSyrveOrderIds,free?[id(10),id(11)]:[]);
    assert.deepEqual(after.state.orderVersions,before.state.orderVersions);
    assert.deepEqual(after.state.activeSyrveOrderIds,before.state.activeSyrveOrderIds);
  });
}

for (const [bookings,status] of [
  [[{status:'approved',checkedInAt:new Date()}],'occupied'],
  [[{status:'approved',checkedInAt:null}],'reserved'],
  [[{status:'pending',checkedInAt:null}],'pending'], [[], 'free'],
]) {
  test(`waiter free preserves ${status} booking outcome while suppressing only known POS orders`,async () => {
    const h=harness(); await open(h); h.mutate((db)=>db.bookings=bookings);
    const before=structuredClone(h.saved().bookings);
    assert.equal((await staff(h).setWaiterStatus(h.table,'free')).status,status);
    assert.deepEqual(h.saved().bookings,before);
    assert.deepEqual(h.saved().link.manually_freed_syrve_order_ids,[id(10),id(11)]);
  });
}

test('same-status action before the first order fences a delayed reply across restart',async () => {
  const h=harness(), c=await h.store.capture(h.table);
  await staff(h).setWaiterStatus(h.table,'free');
  const result=await h.restart().applyObservation(c,[{orderIds:[],probe:probe(c.state.scope,[row(c.state.scope,id(10))])}]);
  assert.deepEqual(result.diagnostics,['local_revision_changed']); assert.equal(result.changed,false);
  assert.deepEqual(h.saved().link.active_syrve_order_ids,[]); assert.equal(h.saved().physical.status,'free');
});

test('change-and-restore cannot make an older capture valid again',async () => {
  const h=harness(), c=await open(h), service=staff(h);
  await service.markCleaning(h.table); await service.markOccupied(h.table);
  const result=await h.restart().applyObservation(c,batches(c,[row(c.state.scope,id(10)),row(c.state.scope,id(11))]));
  assert.deepEqual(result.diagnostics,['local_revision_changed']); assert.equal(h.saved().physical.status,'occupied');
});

test('manual free survives repeated old orders while a different order remains unsuppressed',async () => {
  const h=harness(); await open(h); await staff(h).markFree(h.table);
  const c=await h.restart().capture(h.table);
  const result=await h.store.applyObservation(c,observations(c,[row(c.state.scope,id(10)),row(c.state.scope,id(11)),row(c.state.scope,id(12))]));
  assert.deepEqual(result.state.manuallyFreedSyrveOrderIds,[id(10),id(11)]);
  assert.deepEqual(result.state.activeSyrveOrderIds,[id(10),id(11),id(12)]);
  assert.equal(h.saved().physical.status,'free'); // Effective reads stay disabled.
});

test('late durable failure rolls back a physical status already saved in this transaction',async () => {
  const h=harness(); await open(h); const before=h.saved(); h.failWrite();
  await assert.rejects(staff(h).markFree(h.table),/synthetic write failure/);
  assert.deepEqual(h.saved(),before);
});

test('physical save failure leaves the saved fence and membership unchanged',async () => {
  const h=harness(); await open(h); const before=h.saved(); h.failPhysical();
  await assert.rejects(staff(h).markFree(h.table),/synthetic physical failure/);
  assert.deepEqual(h.saved(),before);
});

test('invalid waiter actions preserve their existing error and publish no state',async () => {
  for (const status of ['closed','reserved','pending']) {
    const h=harness(); h.mutate((db)=>db.physical.status=status); const before=h.saved();
    await assert.rejects(staff(h).setWaiterStatus(h.table,'occupied'),(error)=>error.getStatus()===400);
    assert.deepEqual(h.saved(),before);
  }
  const h=harness(), before=h.saved();
  await assert.rejects(staff(h).setWaiterStatus(h.table,'cleaning'),(error)=>error.getStatus()===400);
  assert.deepEqual(h.saved(),before);
  await assert.rejects(staff(h).markFree(randomUUID()),(error)=>error.getStatus()===404);
  assert.deepEqual(h.saved(),before);
});

test('legacy, incomplete configuration and unlinked tables keep ordinary MOLO actions',async () => {
  for (const prepare of [(h)=>h.legacy(),(h)=>h.unprepareSettings(),(h)=>h.mutate((db)=>db.link=null)]) {
    const h=harness(); prepare(h); h.mutate((db)=>db.physical.status='occupied'); h.queries.length=0;
    assert.equal((await staff(h).setWaiterStatus(h.table,'free')).status,'free');
    assert.equal(h.saved().saved,null); assert.deepEqual(h.saved().versions,[]);
    if (!h.queries.some((sql)=>sql==='settings read')) assert.equal(h.queries.length,1);
  }
});

test('temporarily missing durable schema cannot make old work valid again after recovery',async () => {
  const h=harness(), c=await open(h); h.unprepare();
  await staff(h).markFree(h.table); h.restore();
  await assert.rejects(h.store.applyObservation(c,batches(c,[row(c.state.scope,id(10)),row(c.state.scope,id(11))])),(error)=>error.getStatus()===409);
  const current=await h.restart().capture(h.table);
  assert.deepEqual(current.state.manuallyFreedSyrveOrderIds,[id(10),id(11)]);
  assert.deepEqual(current.state.orderVersions,c.state.orderVersions);
});

test('offline and disconnected bindings keep durable overrides without contacting the provider',async () => {
  for (const status of ['error','not_connected']) {
    const h=harness(), c=await open(h); h.entity.status=status; h.entity.configurationRevision=randomUUID();
    if (status==='not_connected') h.entity.organizationId=null;
    await staff(h).markFree(h.table);
    const saved=h.saved(); assert.equal(saved.physical.status,'free');
    assert.notEqual(saved.saved.local_revision,c.state.localRevision);
    assert.equal(saved.saved.configuration_revision,h.entity.configurationRevision);
    assert.deepEqual(saved.link.manually_freed_syrve_order_ids,[id(10),id(11)]);
    assert.deepEqual(saved.versions,c.state.orderVersions);
    await assert.rejects(h.store.applyObservation(c,[]),(error)=>error.getStatus()===409);
  }
});

test('uppercase UUID paths cannot bypass suppression',async () => {
  const h=harness(); await open(h); await staff(h).markFree(h.table.toUpperCase());
  assert.deepEqual(h.saved().link.manually_freed_syrve_order_ids,[id(10),id(11)]);
});

test('foreign binding or missing watermark cannot produce a half-saved manual action',async () => {
  for (const mutate of [(db)=>db.link.organization_id=randomUUID(),(db)=>db.versions=[]]) {
    const h=harness(); await open(h); h.mutate(mutate); const before=h.saved();
    await assert.rejects(staff(h).markFree(h.table)); assert.deepEqual(h.saved(),before);
  }
});

test('simultaneous staff and observation actions preserve the last local action',async () => {
  for (const staffFirst of [true,false]) {
    const h=harness(), c=await h.store.capture(h.table);
    const manual=()=>staff(h).markFree(h.table);
    const observed=()=>h.store.applyObservation(c,[{orderIds:[],probe:probe(c.state.scope,[row(c.state.scope,id(10))])}]);
    await Promise.all(staffFirst?[manual(),observed()]:[observed(),manual()]);
    assert.equal(h.saved().physical.status,'free');
    assert.deepEqual(h.saved().link.manually_freed_syrve_order_ids,h.saved().link.active_syrve_order_ids);
  }
});

test('transaction-only recording refuses an uncoordinated manager before writes',async () => {
  const h=harness(), before=h.saved();
  await assert.rejects(h.store.recordStaffActionInTransaction({},h.snapshot(),h.table,'manual_free'),(error)=>error.getStatus()===503);
  assert.deepEqual(h.saved(),before);
});

test('Nest resolves the exported staff coordinator without importing a client or creating a module cycle',async () => {
  class LocalDataSourceModule {}
  Global()(LocalDataSourceModule); Module({providers:[{provide:DataSource,useValue:{options:{type:'postgres'}}}],exports:[DataSource]})(LocalDataSourceModule);
  const module=await Test.createTestingModule({imports:[LocalDataSourceModule,SyrveStaffActionsModule]}).compile();
  assert.ok(module.get(SyrveStaffActionsService)); await module.close();
  const read=(p)=>readFileSync(resolve(__dirname,'../src',p),'utf8');
  assert.match(read('tables/tables.module.ts'),/SyrveStaffActionsModule/);
  assert.match(read('tables/tables.service.ts'),/this\.staffActions\.run/);
  assert.doesNotMatch(read('syrve/syrve-staff-actions.service.ts'),/SyrveClient|fetch\(|apiLogin|applyObservation|\.capture\(/);
  assert.doesNotMatch(read('syrve/syrve-staff-actions.module.ts'),/SyrveIntegrationModule|TablesModule|SyrveClient|SyrveStateStore/);
  assert.match(read('syrve/syrve-integration.service.ts'),/syncEnabled: false/);
});

test('PostgreSQL staff validator refuses unauthorized targets before opening connections',async () => {
  const {runSyrveStaffActionsValidation}=await import('../scripts/syrve-staff-actions-validation.mjs');
  await assert.rejects(runSyrveStaffActionsValidation({}),/disabled/);
  await assert.rejects(runSyrveStaffActionsValidation({FRESH_SCHEMA_REFERENCE_ALLOW:'true',DB_URL:'postgres://remote/db'}),/refuses DB_URL/);
});
