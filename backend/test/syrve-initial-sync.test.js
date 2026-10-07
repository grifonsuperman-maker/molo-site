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
test('explicit initial reconciliation restores a known open bill once and keeps its ledger', async t => {
  const { h, values } = await opened(t), versions = h.saved().versions;
  assert.equal(h.saved().physical.status, 'free');
  await apply(h, await evidence(h, values), true);
  assert.equal(h.saved().physical.status, 'occupied');
  assert.deepEqual(h.saved().versions, versions);
  assert.deepEqual(h.saved().link.manually_freed_syrve_order_ids, []);
  await h.store.recordStaffAction(h.table, 'manual_free');
  h.mutate(db => { db.physical.status = 'free'; });
  await apply(h, await evidence(h, values));
  assert.equal(h.saved().physical.status, 'free');
});
test('initial reconciliation with no orders preserves a manual occupied table', async () => {
  const h = harness(); h.mutate(db => { db.physical.status = 'occupied'; });
  await apply(h, await evidence(h, []), true);
  assert.equal(h.saved().physical.status, 'occupied');
});
for (const failure of ['copied receipt', 'manual change', 'missing bill', 'physical write']) {
  test('initial reconciliation rejects ' + failure + ' without publishing status or ledger changes', async t => {
    const { h, values } = await opened(t);
    const e = await evidence(h, failure === 'missing bill' ? [] : values, failure === 'copied receipt');
    if (failure === 'manual change') h.mutate(db => { db.physical.status = 'cleaning'; });
    if (failure === 'physical write') h.failPhysical();
    const before = h.saved();
    await assert.rejects(apply(h, e, true), error => !(error instanceof TypeError));
    assert.deepEqual(h.saved(), before);
  });
}
