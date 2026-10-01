const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { SyrveStateStore } = require('../dist/syrve/syrve-state.store.js');
const { CreateSyrveDurableState2026093000050: Migration } = require('../dist/migrations/2026093000050-CreateSyrveDurableState.js');
const { staleSyrveSettings } = require('../dist/syrve/syrve-settings.store.js');
const { id, row, probe, batches } = require('./helpers/syrve-state-fixtures.js');

// Transactional test double for failure injection. The same scenarios also run
// against the compiled adapter and real PostgreSQL in database-reference CI.
function harness() {
  const entity = { id: randomUUID(), configurationRevision: randomUUID(), organizationId: randomUUID(), status: 'connected' };
  let db = { saved: null, versions: [], link: { id: randomUUID(), integration_id: entity.id,
    organization_id: entity.organizationId, molo_table_id: randomUUID(), syrve_table_id: randomUUID(),
    last_syrve_state: 'unknown', active_syrve_order_ids: [], manually_freed_syrve_order_ids: [] } };
  const queries = []; let prepared = true, fail = false, tail = Promise.resolve();
  const manager = { query: async (sql, args = []) => {
    queries.push(sql);
    if (sql.includes('to_regclass')) return [{ prepared }];
    if (sql.startsWith('SELECT "id"')) return args[0] === db.link.molo_table_id ? [{ id: args[0] }] : [];
    if (sql.startsWith('SELECT *') && sql.includes('syrve_table_links')) return [structuredClone(db.link)];
    if (sql.startsWith('SELECT *')) return db.saved ? [structuredClone(db.saved)] : [];
    if (sql.startsWith('SELECT "order_id"')) return db.versions.map((v) => ({ order_id: v.id, timestamp: String(v.timestamp), state: v.state, fingerprint: v.fingerprint }));
    if (sql.startsWith('INSERT') && sql.includes('syrve_table_sync_states')) {
      db.saved = Object.fromEntries(['link_id','integration_id','configuration_revision','organization_id','molo_table_id','syrve_table_id','local_revision'].map((key, index) => [key,args[index]]));
    } else if (sql.startsWith('INSERT')) {
      const versions = new Map(db.versions.map((v) => [v.id, v]));
      for (const v of JSON.parse(args[1])) versions.set(v.id, v);
      db.versions = [...versions.values()].sort((a,b) => a.id.localeCompare(b.id));
    } else if (sql.startsWith('UPDATE') && sql.includes('syrve_table_links')) {
      db.link.last_syrve_state = args[1]; db.link.active_syrve_order_ids = [...args[2]]; db.link.manually_freed_syrve_order_ids = [...args[3]];
    } else if (sql.startsWith('UPDATE')) {
      if (fail) throw new Error('synthetic write failure');
      db.saved.configuration_revision = args[1]; db.saved.local_revision = args[2];
    }
    return [];
  } };
  const snapshot = () => ({ prepared: true, entity: { ...entity }, links: [] });
  const settings = { read: async () => snapshot(), transaction: async (expected, action) => {
    const previous = tail; let release; tail = new Promise((yes) => release = yes); await previous;
    const before = structuredClone(db);
    try {
      if (expected.id !== entity.id || expected.revision !== entity.configurationRevision) throw staleSyrveSettings();
      return await action(manager, snapshot());
    } catch (error) { db = before; throw error; } finally { release(); }
  } };
  const source = { options: { type: 'postgres', schema: 'public' }, manager };
  const restart = () => new SyrveStateStore(source, settings);
  return { entity, queries, restart, store: restart(), table: db.link.molo_table_id, saved: () => structuredClone(db),
    mutate: (action) => action(db), unprepare: () => prepared = false, failWrite: () => fail = true };
}
async function open(h, orders = [id(10)]) {
  const c = await h.store.capture(h.table);
  await h.store.applyObservation(c, [{ orderIds: c.orderIds[0], probe: probe(c.state.scope, orders.map((orderId) => row(c.state.scope, orderId))) }]);
  return h.store.capture(h.table);
}

test('restart restores complete membership, versions and suppression, without aliasing returned data', async () => {
  const h = harness(); await open(h, [id(10), id(11)]);
  await h.store.recordStaffAction(h.table, 'manual_free');
  const before = await h.store.capture(h.table), restored = await h.restart().capture(h.table);
  assert.deepEqual(restored, before);
  assert.deepEqual(restored.state.manuallyFreedSyrveOrderIds, [id(10),id(11)]);
  restored.state.manuallyFreedSyrveOrderIds.length = 0;
  assert.deepEqual(await h.restart().capture(h.table), before);
  assert.ok(h.queries.filter((sql) => sql.includes('FOR UPDATE')).length >= 3);
  assert.ok(!h.queries.some((sql) => /(?:UPDATE|INSERT INTO).*"tables"/.test(sql)));
});

test('staff change before the first observed order fences a delayed reply across a restart', async () => {
  const h = harness(), captured = await h.store.capture(h.table);
  await h.store.recordStaffAction(h.table, 'status_changed');
  const result = await h.restart().applyObservation(captured, [{ orderIds: [], probe: probe(captured.state.scope, [row(captured.state.scope,id(10))]) }]);
  assert.equal(result.changed, false); assert.deepEqual(result.diagnostics, ['local_revision_changed']);
  assert.deepEqual(result.state.activeSyrveOrderIds, []);
});

test('concurrent complete replies have one winner and cannot overwrite its durable revision', async () => {
  const h = harness(), captured = await h.store.capture(h.table);
  const results = await Promise.all([id(10), id(11)].map((orderId) => h.restart().applyObservation(captured,
    [{ orderIds: [], probe: probe(captured.state.scope, [row(captured.state.scope,orderId)]) }])));
  assert.equal(results.filter((r) => r.changed).length, 1);
  assert.deepEqual((await h.store.capture(h.table)).state, results.find((r) => r.changed).state);
});

test('failure after ledger and link writes rolls the entire transaction back', async () => {
  const h = harness(); await open(h); const before = h.saved(); h.failWrite();
  await assert.rejects(h.store.recordStaffAction(h.table, 'manual_free'), /synthetic write failure/);
  assert.deepEqual(h.saved(), before);
});

test('reconfiguration rotates the fence while preserving the same binding ledger and overrides', async () => {
  const h = harness(); const captured = await open(h); await h.store.recordStaffAction(h.table, 'manual_free');
  const before = h.saved(); h.entity.configurationRevision = randomUUID();
  await assert.rejects(h.store.applyObservation(captured, []), (error) => error.getStatus() === 409);
  const current = await h.restart().capture(h.table);
  assert.notEqual(current.state.localRevision, before.saved.local_revision);
  assert.equal(current.state.scope.configurationRevision, h.entity.configurationRevision);
  assert.deepEqual(current.state.manuallyFreedSyrveOrderIds, before.link.manually_freed_syrve_order_ids);
  assert.deepEqual(current.state.orderVersions, before.versions);
});

test('unknown legacy state, missing schema and foreign binding fail closed without inventing versions', async () => {
  for (const mutate of [
    (h) => h.unprepare(),
    (h) => h.mutate((db) => { db.link.last_syrve_state = 'open'; db.link.active_syrve_order_ids = [id(10)]; }),
    (h) => h.mutate((db) => db.link.organization_id = randomUUID()),
    (h) => { h.entity.status = 'not_connected'; },
  ]) {
    const h = harness(); mutate(h); const before = h.saved();
    await assert.rejects(h.store.capture(h.table)); assert.deepEqual(h.saved(),before);
  }
});

test('a restored active order without a watermark is rejected, rather than recreated with a fabricated version', async () => {
  const h = harness(); await open(h); h.mutate((db) => db.versions = []); const before = h.saved();
  await assert.rejects(h.restart().capture(h.table), /Invalid internal Syrve state/);
  assert.deepEqual(h.saved(),before);
});

test('capture mutations and caller visibility flags cannot clear saved occupancy or overrides', async () => {
  const h = harness(); await open(h); await h.store.recordStaffAction(h.table,'manual_free');
  const c = await h.store.capture(h.table); c.state.activeSyrveOrderIds = []; c.state.manuallyFreedSyrveOrderIds = [];
  c.visibilityVerified = true;
  const value = await h.store.applyObservation(c, batches(c,[row(c.state.scope,id(10),'Closed',200)]));
  assert.deepEqual(value.state.activeSyrveOrderIds,[id(10)]);
  assert.deepEqual(value.state.manuallyFreedSyrveOrderIds,[id(10)]);
  assert.ok(value.diagnostics.includes('visibility_not_verified'));
});

test('4201 tracked UUIDs survive restart and an incomplete later batch publishes no early versions', async () => {
  const h = harness(); const ids = Array.from({ length:4201 },(_,i) => id(100+i));
  // Open discovery is bounded; accumulate independent complete observations.
  for (let i=0;i<ids.length;i+=1500) {
    const c = await h.store.capture(h.table), existing = c.state.activeSyrveOrderIds;
    const values = [...existing, ...ids.slice(i,i+1500)].map((orderId) => row(c.state.scope,orderId));
    const parts = batches(c, values); parts[0].probe.byTable = probe(c.state.scope, values.slice(existing.length)).byTable;
    await h.store.applyObservation(c, parts);
  }
  const c = await h.restart().capture(h.table);
  assert.deepEqual(c.orderIds.map((part) => part.length),[2000,2000,201]);
  const before = h.saved(); const parts = batches(c,ids.map((orderId) => row(c.state.scope,orderId,'Closed',200)));
  parts.pop(); const result = await h.store.applyObservation(c,parts);
  assert.equal(result.changed,false); assert.deepEqual(h.saved(),before);
});

test('migration down refuses any saved fence; empty storage has a reversible down path', async () => {
  const migration = new Migration(); const sql=[];
  await migration.up({ query: async (q) => { sql.push(q); } });
  assert.match(sql.join('\n'),/9007199254740991/); assert.doesNotMatch(sql.join('\n'),/UPDATE "tables"|ALTER TABLE/);
  const blocked=[];
  await assert.rejects(migration.down({ isTransactionActive:true, query:async(q) => { blocked.push(q); return [{present:true}]; } }),/saved state exists/);
  assert.ok(!blocked.some((q) => q.startsWith('DROP')));
  const empty=[]; await migration.down({ isTransactionActive:true, query:async(q) => { empty.push(q); return [{present:false}]; } });
  assert.deepEqual(empty.filter((q) => q.startsWith('DROP')),['DROP TABLE "syrve_order_versions"','DROP TABLE "syrve_table_sync_states"']);
});

test('migration rollback requires a transaction before checking or dropping saved state', async () => {
  const queries=[];
  await assert.rejects(new Migration().down({isTransactionActive:false,query:async(sql) => queries.push(sql)}),/requires an active transaction/);
  assert.deepEqual(queries,[]);
});

test('preparation has no runtime provider, live migration registration, HTTP caller or activation', () => {
  const read = (p) => readFileSync(resolve(__dirname,'../src',p),'utf8');
  const module = read('syrve/syrve-integration.module.ts'); assert.doesNotMatch(module,/SyrveStateStore|syrve-state.store/);
  const app = read('app.module.ts');
  assert.doesNotMatch(app.split('const staffPinMigrationOptions = {')[1].split('};')[0],/CreateSyrveDurableState/);
  assert.match(app,/migrations: isDisposableSchemaReference[\s\S]*CreateSyrveDurableState/);
  for (const file of ['syrve/syrve-integration.controller.ts','syrve/syrve-integration.service.ts','tables/tables.service.ts']) {
    assert.doesNotMatch(read(file),/SyrveStateStore|syrve-state.store/);
  }
});

test('PostgreSQL storage validator refuses remote and unapproved targets before opening connections', async () => {
  const { runSyrveStateStorageValidation } = await import('../scripts/syrve-state-storage-validation.mjs');
  await assert.rejects(runSyrveStateStorageValidation({}),/disabled/);
  await assert.rejects(runSyrveStateStorageValidation({ FRESH_SCHEMA_REFERENCE_ALLOW:'true', DB_URL:'postgres://remote/db' }),/refuses DB_URL/);
});
