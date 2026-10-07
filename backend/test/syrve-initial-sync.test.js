const test = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('./helpers/syrve-state-harness.js');
const { confirmed } = require('./helpers/syrve-confirmed-worker.js');
const { id, row, probe } = require('./helpers/syrve-state-fixtures.js');
const { syrveCaptureContext } = require('../dist/syrve/syrve-state.store.js');
const { tableLoadingPlan } = require('../dist/syrve/syrve-table-loading.js');

async function evidence(h, values, copied = false) {
  const capture = await h.store.capture(h.table), lease = id(701);
  const batches = [];
  for (const ids of capture.orderIds) {
    const value = await confirmed(capture, ids, {
      deadline: Date.now() + 45000, beforeCommand: async () => {},
      visibilityContext: syrveCaptureContext(lease, capture),
      loadingPlan: tableLoadingPlan(probe(capture.state.scope, values), [capture.state.scope.syrveTableId]),
    }, async () => probe(capture.state.scope, values, ids));
    batches.push({ orderIds: ids, probe: copied ? structuredClone(value) : value });
  }
  return { capture, batches, lease };
}
function apply(h, e, initial = false) {
  const action = initial ? 'applyActivationObservationInTransaction' : 'applyWorkerObservationInTransaction';
  return h.settings.transaction({ id: h.entity.id, revision: h.entity.configurationRevision },
    (manager, snapshot) => h.store[action](manager, snapshot, e.capture, e.batches, e.lease));
}
async function opened(t) {
  const h = harness(), c = await h.store.capture(h.table);
  const values = [row(c.state.scope, id(700))];
  await apply(h, await evidence(h, values));
  await h.store.recordStaffAction(h.table, 'manual_free');
  h.mutate(db => { db.physical.status = 'free'; });
  return { h, values };
}
for (const status of ['free', 'cleaning', 'reserved', 'closed', 'occupied']) {
  test('initial reconciliation preserves an already consumed opening after manual ' + status, async t => {
    const { h, values } = await opened(t);
    if (status !== 'free') {
      await h.store.recordStaffAction(h.table, 'status_changed');
      h.mutate(db => { db.physical.status = status; });
    }
    const e = await evidence(h, values), before = h.saved();
    const result = await apply(h, e, true);
    assert.equal(result.changed, false);
    assert.deepEqual(h.saved(), before, 'Activation must preserve the manual status, revision, marker and ledger');
    await apply(h, await evidence(h, values));
    assert.deepEqual(h.saved(), before);
  });
}
for (const status of ['New', 'Bill']) {
  test('initial reconciliation keeps manual release when a known bill receives an updated ' + status + ' version', async t => {
    const { h } = await opened(t), scope = (await h.store.capture(h.table)).state.scope;
    await apply(h, await evidence(h, [row(scope, id(700), status, 101)]), true);
    assert.equal(h.saved().physical.status, 'free');
    assert.deepEqual(h.saved().link.manually_freed_syrve_order_ids, [id(700)]);
    assert.equal(h.saved().versions.find(version => version.id === id(700)).timestamp, 101);
  });
}
for (const status of ['free', 'cleaning', 'reserved', 'closed', 'occupied']) {
  test('initial reconciliation applies a previously unseen opening over manual ' + status + ' exactly once', async () => {
    const h = harness();h.mutate(db => { db.physical.status = status; });
    const scope = (await h.store.capture(h.table)).state.scope, values = [row(scope, id(702))];
    await apply(h, await evidence(h, values), true);
    assert.equal(h.saved().physical.status, 'occupied');
    await h.store.recordStaffAction(h.table, 'manual_free');h.mutate(db => { db.physical.status = 'free'; });
    const before = h.saved();
    await apply(h, await evidence(h, values), true);
    assert.deepEqual(h.saved(), before);
  });
}
test('initial reconciliation applies a new bill after a known bill was manually released', async t => {
  const { h, values } = await opened(t), scope = (await h.store.capture(h.table)).state.scope;
  await apply(h, await evidence(h, [...values, row(scope, id(702))]), true);
  assert.equal(h.saved().physical.status, 'occupied');
  assert.deepEqual(h.saved().link.active_syrve_order_ids, [id(700), id(702)]);
});
test('initial reconciliation releases the table on confirmed last closure after manual occupancy', async t => {
  const { h } = await opened(t);await h.store.recordStaffAction(h.table, 'status_changed');
  h.mutate(db => { db.physical.status = 'occupied'; });
  const scope = (await h.store.capture(h.table)).state.scope;
  await apply(h, await evidence(h, [row(scope, id(700), 'Closed', 200)]), true);
  assert.equal(h.saved().physical.status, 'free');
  assert.deepEqual(h.saved().link.active_syrve_order_ids, []);
});
test('initial reconciliation with no orders preserves a manual occupied table', async () => {
  const h = harness(); h.mutate(db => { db.physical.status = 'occupied'; });
  await apply(h, await evidence(h, []), true);
  assert.equal(h.saved().physical.status, 'occupied');
});
for (const failure of ['copied receipt', 'manual change', 'missing bill', 'physical write']) {
  test('initial reconciliation rejects ' + failure + ' without publishing status or ledger changes', async t => {
    const { h, values } = await opened(t);
    const observed = failure === 'missing bill' ? [] : failure === 'physical write'
      ? [...values, row((await h.store.capture(h.table)).state.scope, id(702))] : values;
    const e = await evidence(h, observed, failure === 'copied receipt');
    if (failure === 'manual change') h.mutate(db => { db.physical.status = 'cleaning'; });
    if (failure === 'physical write') h.failPhysical();
    const before = h.saved();
    await assert.rejects(apply(h, e, true), error => !(error instanceof TypeError));
    assert.deepEqual(h.saved(), before);
  });
}
