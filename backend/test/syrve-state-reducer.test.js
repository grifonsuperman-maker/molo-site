const assert = require('node:assert/strict');
const test = require('node:test');
const { createSyrveTableSyncState, reduceSyrveOrderState, reduceSyrveStaffAction,
  projectSyrveTableStatus, SyrveStateValidationError } = require('../dist/syrve/syrve-state-reducer.js');
const { parseSyrveOrders } = require('../dist/syrve/syrve-order-observer.js');

const id = (n) => `b0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ORG = id(1), GROUP = id(2), TABLE = id(3), TABLE2 = id(4), ORDER = id(10), ORDER2 = id(11), ORDER3 = id(12);
const SCOPE = { integrationId: id(20), configurationRevision: id(21), organizationId: ORG, moloTableId: id(22), syrveTableId: TABLE };
let revision = 10000;
const initial = () => createSyrveTableSyncState(SCOPE, id(revision++));
const row = (orderId = ORDER, status = 'New', timestamp = 100, tableIds = [TABLE]) => ({
  id: orderId, organizationId: ORG, timestamp, creationStatus: 'Success',
  order: { status, tableIds, terminalGroupId: GROUP },
});
const pending = (orderId = ORDER, timestamp = 200) => ({ id: orderId, organizationId: ORG,
  timestamp, creationStatus: 'InProgress', order: null });
function probe(rows = [], overrides = {}) {
  const orders = parseSyrveOrders({ correlationId: id(99), orders: rows }, ORG, { tableIds: [TABLE, TABLE2] });
  return { organizationId: ORG, startedAt: '2026-10-01T07:00:00Z', completedAt: '2026-10-01T07:00:01Z',
    authentication: 'legacy_v1', checks: Object.fromEntries(['connection', 'terminalGroups', 'restaurantSections',
      'posAvailability', 'ordersByTable', 'ordersById'].map((key) => [key, { status: 'ok', code: null }])),
    terminalGroups: { active: [{ id: GROUP }], sleeping: [] },
    catalogTables: [{ id: TABLE, terminalGroupId: GROUP, isDeleted: false }, { id: TABLE2, terminalGroupId: GROUP, isDeleted: false }],
    availability: [{ terminalGroupId: GROUP, isAlive: true }], byTable: orders, byId: structuredClone(orders), ...overrides };
}
function fence(state, overrides = {}) {
  return { expectedScope: structuredClone(state.scope), currentScope: structuredClone(state.scope),
    expectedRevision: state.localRevision, nextRevision: id(revision++), ...overrides };
}
function observe(state, rows = [], overrides = {}) {
  // Verified visibility is synthetic server context, never inferred from PR 6.
  return reduceSyrveOrderState(state, { ...fence(state), probe: probe(rows), visibilityVerified: true, ...overrides });
}
const opened = (...rows) => observe(initial(), rows.length ? rows : [row()]).state;
const staff = (state, action = 'manual_free', overrides = {}) => reduceSyrveStaffAction(state, { ...fence(state), action, ...overrides });
function status(state, overrides = {}) {
  return projectSyrveTableStatus(state, { currentScope: SCOPE, syncEnabled: true, view: 'today', hidden: false,
    zoneClosed: false, manualStatus: 'free', booking: 'none', checkedIn: false, ...overrides });
}
function freeze(value) {
  if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(freeze); }
  return value;
}

test('first empty observation never proves a free/closed table, even with verified visibility', () => {
  const state = initial(), result = observe(state);
  assert.equal(result.changed, false); assert.deepEqual(result.state, state);
  assert.equal(result.state.lastSyrveState, 'unknown');
  assert.deepEqual(result.state.activeSyrveOrderIds, []);
});

for (const orderStatus of ['New', 'Bill']) {
  test(`${orderStatus} adds a positive open UUID and projects occupied without touching the manual source`, () => {
    const state = initial(), result = observe(state, [row(ORDER, orderStatus)], { visibilityVerified: false });
    assert.equal(result.state.lastSyrveState, 'open');
    assert.deepEqual(result.state.activeSyrveOrderIds, [ORDER]);
    assert.equal(status(result.state, { manualStatus: 'cleaning' }), 'occupied');
    assert.deepEqual(result.diagnostics, ['visibility_not_verified']);
    assert.deepEqual(state, { ...initial(), localRevision: state.localRevision });
  });
}

test('all orders are sets; closing one cannot release the remaining open order', () => {
  const state = opened(row(ORDER), row(ORDER2, 'Bill'));
  const one = observe(state, [row(ORDER, 'Closed', 200), row(ORDER2, 'Bill', 200)]);
  assert.deepEqual(one.state.activeSyrveOrderIds, [ORDER2]); assert.equal(status(one.state), 'occupied');
  assert.equal(one.state.lastSyrveState, 'open');
  const last = observe(one.state, [row(ORDER2, 'Deleted', 300)]);
  assert.deepEqual(last.state.activeSyrveOrderIds, []); assert.equal(last.state.lastSyrveState, 'closed');
  assert.equal(status(last.state), 'free');
});

for (const terminalStatus of ['Closed', 'Deleted']) {
  test(`${terminalStatus} removes only POS occupancy and preserves manual and booking sources`, () => {
    const state = observe(opened(), [row(ORDER, terminalStatus, 200)]).state;
    assert.equal(status(state, { manualStatus: 'occupied' }), 'occupied');
    assert.equal(status(state, { manualStatus: 'cleaning' }), 'cleaning');
    assert.equal(status(state, { manualStatus: 'closed' }), 'closed');
    assert.equal(status(state, { booking: 'approved', checkedIn: true }), 'occupied');
    assert.equal(status(state, { booking: 'approved' }), 'reserved');
    assert.equal(status(state, { booking: 'pending' }), 'pending');
  });
}

test('unverified visibility cannot release the last known order or clear its manual override', () => {
  const state = staff(opened()).state;
  const blocked = observe(state, [row(ORDER, 'Closed', 200)], { visibilityVerified: false });
  assert.deepEqual(blocked.state.activeSyrveOrderIds, [ORDER]);
  assert.deepEqual(blocked.state.manuallyFreedSyrveOrderIds, [ORDER]);
  assert.equal(blocked.state.lastSyrveState, 'open'); assert.equal(status(blocked.state), 'free');
  const trusted = observe(blocked.state, [row(ORDER, 'Closed', 200)]);
  assert.deepEqual(trusted.state.activeSyrveOrderIds, []);
  assert.deepEqual(trusted.state.manuallyFreedSyrveOrderIds, []);
});

test('missing, moved and pending orders retain occupancy; partial closure cannot erase either active UUID', () => {
  for (const unknown of [null, row(ORDER2, 'New', 200, [TABLE2]), pending(ORDER2, 200)]) {
    const state = opened(row(ORDER), row(ORDER2));
    const result = observe(state, [row(ORDER, 'Closed', 200), ...unknown ? [unknown] : []]);
    assert.deepEqual(result.state.activeSyrveOrderIds, [ORDER, ORDER2]);
    assert.ok(result.diagnostics.includes('unknown_orders')); assert.equal(status(result.state), 'occupied');
  }
});

test('an unassociated pending discovery also blocks closure rather than assuming it belongs elsewhere', () => {
  const result = observe(opened(), [row(ORDER, 'Closed', 200), pending(ORDER2)]);
  assert.deepEqual(result.state.activeSyrveOrderIds, [ORDER]); assert.equal(status(result.state), 'occupied');
});

test('missing observations preserve complete prior state and do not clear overrides', () => {
  const state = staff(opened()).state, result = observe(state);
  assert.deepEqual(result.state, state); assert.equal(result.changed, false);
  assert.ok(result.diagnostics.includes('unknown_orders'));
});

for (const check of ['connection', 'terminalGroups', 'restaurantSections', 'posAvailability', 'ordersByTable', 'ordersById']) {
  test(`failed ${check} retains last good state including provider versions and staff overrides`, () => {
    const state = staff(opened()).state, failed = probe([row(ORDER, 'Closed', 999)]);
    failed.checks[check] = { status: 'error', code: 'SYRVE_UNAVAILABLE' };
    const result = observe(state, [], { probe: failed });
    assert.equal(result.changed, false); assert.deepEqual(result.state, state);
    assert.deepEqual(result.diagnostics, ['observation_unknown']);
  });
}

for (const [name, overrides] of [
  ['offline POS', { availability: [{ terminalGroupId: GROUP, isAlive: false }] }],
  ['missing table', { catalogTables: [] }],
  ['deleted table', { catalogTables: [{ id: TABLE, terminalGroupId: GROUP, isDeleted: true }] }],
  ['sleeping POS', { availability: [], terminalGroups: { active: [], sleeping: [{ id: GROUP }] } }],
]) {
  test(`${name} cannot replace last known occupancy or version watermarks`, () => {
    const state = opened(), result = observe(state, [], { probe: probe([row(ORDER, 'Closed', 999)], overrides) });
    assert.equal(result.changed, false); assert.deepEqual(result.state, state);
    assert.equal(status(result.state), 'occupied');
  });
}

test('older provider closure cannot remove an order or manual override', () => {
  const state = staff(opened(row(ORDER, 'New', 500))).state;
  const result = observe(state, [row(ORDER, 'Closed', 499)]);
  assert.equal(result.changed, false); assert.deepEqual(result.state, state);
  assert.ok(result.diagnostics.includes('stale_order'));
});

test('newer unknown watermark fences later-arriving older closure while retaining known occupancy', () => {
  const state = opened(), unknown = observe(state, [pending(ORDER, 500)]);
  assert.deepEqual(unknown.state.activeSyrveOrderIds, [ORDER]);
  assert.equal(unknown.state.orderVersions[0].timestamp, 500);
  const stale = observe(unknown.state, [row(ORDER, 'Closed', 400)]);
  assert.deepEqual(stale.state, unknown.state); assert.ok(stale.diagnostics.includes('stale_order'));
  assert.deepEqual(observe(unknown.state, [row(ORDER, 'Closed', 501)]).state.activeSyrveOrderIds, []);
});

test('equal conflicting versions remain unknown across cycles until a strictly newer version resolves them', () => {
  const state = opened(), conflict = observe(state, [row(ORDER, 'Closed', 100)]);
  assert.deepEqual(conflict.state.activeSyrveOrderIds, [ORDER]);
  assert.equal(conflict.state.orderVersions[0].fingerprint, null);
  assert.ok(conflict.diagnostics.includes('conflicting_order_versions'));
  const replay = observe(conflict.state, [row(ORDER, 'Closed', 100)]);
  assert.equal(replay.changed, false); assert.deepEqual(replay.state, conflict.state);
  assert.deepEqual(observe(replay.state, [row(ORDER, 'Closed', 101)]).state.activeSyrveOrderIds, []);
});

for (const conflictingId of [ORDER, ORDER2]) {
  for (const conflictStatus of ['Bill', 'Closed']) {
    test(`stored-version conflict ${conflictingId} / ${conflictStatus} blocks every closure and override removal`, () => {
      const otherId = conflictingId === ORDER ? ORDER2 : ORDER;
      const state = staff(opened(row(ORDER), row(ORDER2))).state;
      const result = observe(state, [row(conflictingId, conflictStatus, 100), row(otherId, 'Closed', 200)]);
      assert.deepEqual(result.state.activeSyrveOrderIds, [ORDER, ORDER2]);
      assert.deepEqual(result.state.manuallyFreedSyrveOrderIds, [ORDER, ORDER2]);
      assert.equal(result.state.lastSyrveState, 'open');
      assert.ok(result.diagnostics.includes('conflicting_order_versions'));
    });
  }
}

test('persisted conflict keeps the entire set across replays; newer resolution permits exact closures', () => {
  const state = staff(opened(row(ORDER), row(ORDER2))).state;
  const conflict = observe(state, [row(ORDER, 'Closed', 100), row(ORDER2, 'New', 200)]).state;
  const replay = observe(conflict, [row(ORDER, 'Closed', 100), row(ORDER2, 'Closed', 201)]);
  assert.deepEqual(replay.state.activeSyrveOrderIds, [ORDER, ORDER2]);
  assert.deepEqual(replay.state.manuallyFreedSyrveOrderIds, [ORDER, ORDER2]);
  const resolved = observe(replay.state, [row(ORDER, 'New', 101), row(ORDER2, 'Closed', 201)]).state;
  assert.deepEqual(resolved.activeSyrveOrderIds, [ORDER]);
  assert.deepEqual(resolved.manuallyFreedSyrveOrderIds, [ORDER]);
  const closed = observe(resolved, [row(ORDER, 'Closed', 102)]).state;
  assert.deepEqual(closed.activeSyrveOrderIds, []); assert.deepEqual(closed.manuallyFreedSyrveOrderIds, []);
});

test('conflicting by-table/by-id versions are unknown and cannot close the previous order', () => {
  const state = opened(), value = probe([row(ORDER, 'New', 200)]);
  value.byId = parseSyrveOrders({ correlationId: id(99), orders: [row(ORDER, 'Closed', 200)] }, ORG, { orderIds: [ORDER] });
  const result = observe(state, [], { probe: value });
  assert.deepEqual(result.state.activeSyrveOrderIds, [ORDER]);
  assert.ok(result.diagnostics.includes('unknown_orders'));
});

test('closed tombstones block delayed old open replay; a genuinely newer reopening is accepted', () => {
  const closed = observe(opened(), [row(ORDER, 'Closed', 200)]).state;
  const stale = observe(closed, [row(ORDER, 'New', 150)]);
  assert.equal(stale.changed, false); assert.deepEqual(stale.state, closed);
  const reopened = observe(closed, [row(ORDER, 'New', 201)]);
  assert.deepEqual(reopened.state.activeSyrveOrderIds, [ORDER]); assert.equal(status(reopened.state), 'occupied');
});

test('historical untracked closure cannot turn an initial unknown table into closed', () => {
  const result = observe(initial(), [row(ORDER, 'Closed')]);
  assert.equal(result.state.lastSyrveState, 'unknown');
  assert.deepEqual(result.state.activeSyrveOrderIds, []);
  assert.deepEqual(observe(result.state, [row(ORDER, 'New', 99)]).state.activeSyrveOrderIds, []);
});

test('manual free suppresses every observed UUID, repeated same orders stay suppressed, new UUID occupies', () => {
  const state = opened(row(ORDER), row(ORDER2, 'Bill')), freed = staff(state).state;
  assert.deepEqual(freed.activeSyrveOrderIds, [ORDER, ORDER2]);
  assert.deepEqual(freed.manuallyFreedSyrveOrderIds, [ORDER, ORDER2]); assert.equal(status(freed), 'free');
  const repeated = observe(freed, [row(ORDER, 'New', 200), row(ORDER2, 'Bill', 200)]).state;
  assert.deepEqual(repeated.manuallyFreedSyrveOrderIds, [ORDER, ORDER2]); assert.equal(status(repeated), 'free');
  const next = observe(repeated, [row(ORDER, 'New', 300), row(ORDER2, 'Bill', 300), row(ORDER3, 'New', 300)]).state;
  assert.deepEqual(next.manuallyFreedSyrveOrderIds, [ORDER, ORDER2]); assert.equal(status(next), 'occupied');
});

test('closing suppressed UUID clears only its override; the remaining suppressed order stays free', () => {
  const state = staff(opened(row(ORDER), row(ORDER2))).state;
  const result = observe(state, [row(ORDER, 'Closed', 200), row(ORDER2, 'New', 200)]).state;
  assert.deepEqual(result.activeSyrveOrderIds, [ORDER2]); assert.deepEqual(result.manuallyFreedSyrveOrderIds, [ORDER2]);
  assert.equal(status(result, { booking: 'approved' }), 'reserved');
});

test('manual free keeps checked-in, reserved and pending booking outcomes', () => {
  const state = staff(opened()).state;
  assert.equal(status(state, { booking: 'approved', checkedIn: true }), 'occupied');
  assert.equal(status(state, { booking: 'approved' }), 'reserved');
  assert.equal(status(state, { booking: 'pending' }), 'pending');
});

test('response fetched before manual free is rejected even if it contains a new order', () => {
  const before = opened(), request = { ...fence(before), probe: probe([row(ORDER), row(ORDER2)]), visibilityVerified: true };
  const current = staff(before).state, result = reduceSyrveOrderState(current, request);
  assert.equal(result.changed, false); assert.deepEqual(result.state, current);
  assert.deepEqual(result.diagnostics, ['local_revision_changed']); assert.equal(status(result.state), 'free');
});

test('staff actions before first order and change/restore both rotate the local fence', () => {
  const before = initial(), captured = { ...fence(before), probe: probe([row()]), visibilityVerified: true };
  const changed = staff(before, 'status_changed').state, restored = staff(changed, 'status_changed').state;
  assert.equal(reduceSyrveOrderState(restored, captured).changed, false);
  assert.deepEqual(restored.activeSyrveOrderIds, []); assert.notEqual(restored.localRevision, before.localRevision);
  assert.notEqual(staff(before).state.localRevision, before.localRevision);
});

test('replayed and concurrent whole requests fail their local revision fence, without throwing', () => {
  const state = initial(), request = { ...fence(state), probe: probe([row()]), visibilityVerified: true };
  const result = reduceSyrveOrderState(state, request);
  const replay = reduceSyrveOrderState(result.state, request);
  assert.equal(replay.changed, false); assert.deepEqual(replay.state, result.state);
  assert.deepEqual(replay.diagnostics, ['local_revision_changed']);
  assert.equal(staff(result.state, 'manual_free', { expectedRevision: state.localRevision }).changed, false);
});

for (const key of Object.keys(SCOPE)) {
  test(`changed ${key} rejects late read and staff action without affecting the saved scope`, () => {
    const state = opened(), foreign = { ...SCOPE, [key]: id(90) };
    for (const override of [{ expectedScope: foreign }, { currentScope: foreign }]) {
      const result = observe(state, [row(ORDER, 'Closed', 200)], override);
      assert.deepEqual(result.state, state); assert.deepEqual(result.diagnostics, ['scope_changed']);
      assert.equal(staff(state, 'manual_free', override).changed, false);
    }
    assert.equal(status(state, { currentScope: foreign }), 'free');
  });
}

test('disconnect and foreign organization do not advance state or apply POS occupancy', () => {
  const state = opened();
  assert.deepEqual(observe(state, [row(ORDER, 'Closed', 200)], { currentScope: null }).state, state);
  assert.deepEqual(observe(state, [], { probe: probe([], { organizationId: id(90) }) }).state, state);
  assert.equal(status(state, { currentScope: null }), 'free');
  assert.equal(status(state, { syncEnabled: false, manualStatus: 'cleaning' }), 'cleaning');
});

test('hidden/closed, occupied, cleaning, reserved/pending/free retain their priority', () => {
  const state = opened();
  assert.equal(status(state, { hidden: true, manualStatus: 'closed' }), 'hidden');
  assert.equal(status(state, { zoneClosed: true }), 'closed');
  assert.equal(status(state, { manualStatus: 'closed', checkedIn: true, booking: 'approved' }), 'closed');
  assert.equal(status(state, { manualStatus: 'cleaning', booking: 'approved' }), 'occupied');
  const suppressed = staff(state).state;
  assert.equal(status(suppressed, { manualStatus: 'cleaning', booking: 'approved' }), 'cleaning');
  assert.equal(status(suppressed, { manualStatus: 'pending', booking: 'approved' }), 'reserved');
  assert.equal(status(suppressed, { manualStatus: 'pending' }), 'pending');
});

for (const manualStatus of ['free', 'pending', 'reserved', 'occupied', 'cleaning']) {
  test(`future bookings ignore POS occupancy and today's ${manualStatus} source`, () => {
    const state = opened();
    assert.equal(status(state, { view: 'future', manualStatus }), 'free');
    assert.equal(status(state, { view: 'future', manualStatus, booking: 'pending' }), 'pending');
    assert.equal(status(state, { view: 'future', manualStatus, booking: 'approved', checkedIn: true }), 'reserved');
    assert.equal(status(state, { view: 'future', manualStatus, hidden: true }), 'hidden');
  });
}

test('an order spanning physical tables reduces separately; suppressing one link never suppresses another', () => {
  const secondScope = { ...SCOPE, moloTableId: id(23), syrveTableId: TABLE2 };
  const rows = [row(ORDER, 'New', 100, [TABLE, TABLE2])];
  const first = observe(initial(), rows).state;
  const second = observe(createSyrveTableSyncState(secondScope, id(revision++)), rows).state;
  assert.equal(status(staff(first).state), 'free');
  assert.equal(status(second, { currentScope: secondScope }), 'occupied');
});

test('order orderings and UUID case yield the same canonical sets and versions', () => {
  const state = initial(), nextRevision = id(revision++), a = row(), b = row(ORDER2, 'Bill');
  const first = observe(state, [a, b], { nextRevision });
  const second = observe(state, [b, a], { nextRevision });
  assert.deepEqual(first, second);
  const upper = structuredClone(state); Object.keys(upper.scope).forEach((key) => upper.scope[key] = upper.scope[key].toUpperCase());
  assert.deepEqual(observe(upper, [a, b], { nextRevision }), first);
});

test('repeated identical observations are idempotent and do not rotate the local revision', () => {
  const state = opened(), result = observe(state, [row()]);
  assert.equal(result.changed, false); assert.deepEqual(result.state, state);
});

test('frozen inputs are unchanged and returned state shares no mutable arrays or metadata', () => {
  const state = freeze(opened()), input = freeze({ ...fence(state), probe: probe([row(ORDER, 'New', 200)]), visibilityVerified: true });
  const before = structuredClone({ state, input }), result = reduceSyrveOrderState(state, input);
  result.state.scope.moloTableId = id(90); result.state.orderVersions[0].timestamp = 999;
  result.state.activeSyrveOrderIds.push(ORDER2);
  assert.deepEqual({ state, input }, before);
  const action = staff(state); action.state.manuallyFreedSyrveOrderIds.push(ORDER2);
  assert.deepEqual(state, before.state);
});

test('cumulative known sets exceed one provider response cap without truncation or local rejection', () => {
  let state = initial();
  for (let offset = 0; offset < 2100; offset += 700) {
    state = observe(state, Array.from({ length: 700 }, (_, index) => row(id(100000 + offset + index), 'New', 100))).state;
  }
  assert.equal(state.activeSyrveOrderIds.length, 2100); assert.equal(state.orderVersions.length, 2100);
  const freed = staff(state).state;
  assert.equal(freed.manuallyFreedSyrveOrderIds.length, 2100); assert.equal(status(freed), 'free');
});

for (const [name, mutate] of [
  ['invalid scope UUID', (s) => s.scope.moloTableId = 'not-a-uuid'],
  ['duplicate active IDs', (s) => s.activeSyrveOrderIds.push(ORDER)],
  ['foreign override', (s) => s.manuallyFreedSyrveOrderIds.push(ORDER2)],
  ['missing active watermark', (s) => s.orderVersions = []],
  ['duplicate watermark', (s) => s.orderVersions.push({ ...s.orderVersions[0] })],
  ['negative provider version', (s) => s.orderVersions[0].timestamp = -1],
  ['unsafe provider version', (s) => s.orderVersions[0].timestamp = Number.MAX_SAFE_INTEGER + 1],
  ['malformed fingerprint', (s) => s.orderVersions[0].fingerprint = 'restaurant-secret'],
  ['contradictory last state', (s) => s.lastSyrveState = 'closed'],
]) {
  test(`${name} fails before a transition with a fixed error and no partial mutation`, () => {
    const state = opened(); mutate(state); const before = structuredClone(state);
    assert.throws(() => observe(state, [row(ORDER, 'Closed', 200)]), (error) =>
      error instanceof SyrveStateValidationError && error.message === 'Invalid internal Syrve state');
    assert.deepEqual(state, before);
  });
}

test('unchanged next revision and malformed server proof are rejected, never treated as activation', () => {
  const state = opened();
  assert.throws(() => observe(state, [], { nextRevision: state.localRevision }), SyrveStateValidationError);
  assert.throws(() => observe(state, [], { visibilityVerified: 'true' }), SyrveStateValidationError);
  assert.throws(() => status(state, { checkedIn: true }), SyrveStateValidationError);
  assert.throws(() => status(state, { syncEnabled: 'true' }), SyrveStateValidationError);
});

for (const [name, mutate] of [
  ['unsafe observation version', (order) => order.timestamp = Number.MAX_SAFE_INTEGER + 1],
  ['negative observation version', (order) => order.timestamp = -1],
  ['contradictory closing evidence', (order) => order.status = 'New'],
]) {
  test(`${name} cannot close a table even if a future internal caller bypasses the client parser`, () => {
    const state = opened(), value = probe([row(ORDER, 'Closed', 200)]);
    mutate(value.byTable[0]); value.byId = structuredClone(value.byTable);
    const before = structuredClone(state);
    assert.throws(() => observe(state, [], { probe: value }), SyrveStateValidationError);
    assert.deepEqual(state, before);
  });
}
