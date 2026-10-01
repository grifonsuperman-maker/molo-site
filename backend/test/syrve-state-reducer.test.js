const assert = require('node:assert/strict');
const test = require('node:test');
const { createSyrveTableSyncState, reduceSyrveOrderState, reduceSyrveStaffAction,
  projectSyrveTableStatus, getSyrveOrderIdsToObserve, SyrveStateValidationError } = require('../dist/syrve/syrve-state-reducer.js');
const { parseSyrveOrders } = require('../dist/syrve/syrve-order-observer.js');
const { SyrveClient } = require('../dist/syrve/syrve-client.js');

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

for (const conflictingId of [ORDER, ORDER2]) {
  for (const staleStatus of ['New', 'Closed']) {
    test(`persisted ambiguity ${conflictingId} / stale ${staleStatus} blocks the other order's closure`, () => {
      const otherId = conflictingId === ORDER ? ORDER2 : ORDER;
      const state = staff(opened(row(ORDER), row(ORDER2))).state;
      const conflicted = observe(state, [row(conflictingId, 'Closed', 100), row(otherId, 'New', 100)]).state;
      const result = observe(conflicted, [row(conflictingId, staleStatus, 99), row(otherId, 'Closed', 200)]);
      assert.deepEqual(result.state.activeSyrveOrderIds, [ORDER, ORDER2]);
      assert.deepEqual(result.state.manuallyFreedSyrveOrderIds, [ORDER, ORDER2]);
      assert.ok(result.diagnostics.includes('conflicting_order_versions'));
    });
  }
}

test('higher unknown evidence keeps ambiguity through a later stale open, until newer usable evidence', () => {
  const state = staff(opened(row(ORDER), row(ORDER2))).state;
  const conflict = observe(state, [row(ORDER, 'Closed', 100), row(ORDER2, 'New', 100)]).state;
  const unknown = observe(conflict, [pending(ORDER, 500), row(ORDER2, 'New', 200)]).state;
  const stale = observe(unknown, [row(ORDER, 'New', 499), row(ORDER2, 'Closed', 300)]);
  assert.deepEqual(stale.state.activeSyrveOrderIds, [ORDER, ORDER2]);
  assert.deepEqual(stale.state.manuallyFreedSyrveOrderIds, [ORDER, ORDER2]);
  const resolved = observe(stale.state, [row(ORDER, 'New', 501), row(ORDER2, 'Closed', 300)]).state;
  assert.deepEqual(resolved.activeSyrveOrderIds, [ORDER]);
  assert.deepEqual(resolved.manuallyFreedSyrveOrderIds, [ORDER]);
});

test('ordinary unknown watermark blocks partial closure when the next evidence for it is stale', () => {
  const state = staff(opened(row(ORDER), row(ORDER2))).state;
  const unknown = observe(state, [pending(ORDER, 200), row(ORDER2, 'New', 100)]).state;
  const result = observe(unknown, [row(ORDER, 'New', 199), row(ORDER2, 'Closed', 300)]);
  assert.deepEqual(result.state.activeSyrveOrderIds, [ORDER, ORDER2]);
  assert.deepEqual(result.state.manuallyFreedSyrveOrderIds, [ORDER, ORDER2]);
  assert.ok(result.diagnostics.includes('unknown_orders'));
});

test('persisted unassociated tombstone ambiguity blocks closure until explicitly resolved at a newer version', () => {
  let state = opened(row(ORDER), row(ORDER2));
  state = observe(state, [row(ORDER, 'Closed', 200), row(ORDER2, 'New', 200)]).state;
  state = staff(state).state;
  const conflicted = observe(state, [row(ORDER, 'New', 200), row(ORDER2, 'New', 300)]).state;
  assert.deepEqual(conflicted.activeSyrveOrderIds, [ORDER2]);
  assert.deepEqual(getSyrveOrderIdsToObserve(conflicted), [[ORDER, ORDER2]]);
  const absent = observe(conflicted, [row(ORDER2, 'Closed', 400)]);
  assert.deepEqual(absent.state.activeSyrveOrderIds, [ORDER2]);
  assert.deepEqual(absent.state.manuallyFreedSyrveOrderIds, [ORDER2]);
  const resolved = observe(absent.state, [row(ORDER, 'Closed', 201), row(ORDER2, 'Closed', 400)]).state;
  assert.deepEqual(resolved.activeSyrveOrderIds, []); assert.deepEqual(resolved.manuallyFreedSyrveOrderIds, []);
  assert.deepEqual(getSyrveOrderIdsToObserve(resolved), [[]]);
});

test('new unassociated discovery watermark blocks stale closure until a newer usable version identifies it', () => {
  const state = staff(opened()).state;
  const unknown = observe(state, [row(ORDER), pending(ORDER2, 500)]).state;
  assert.deepEqual(getSyrveOrderIdsToObserve(unknown), [[ORDER, ORDER2]]);
  const stale = observe(unknown, [row(ORDER, 'Closed', 600), row(ORDER2, 'Closed', 499)]).state;
  assert.deepEqual(stale.activeSyrveOrderIds, [ORDER]);
  assert.deepEqual(stale.manuallyFreedSyrveOrderIds, [ORDER]);
  const resolved = observe(stale, [row(ORDER, 'Closed', 600), row(ORDER2, 'Closed', 501)]).state;
  assert.deepEqual(resolved.activeSyrveOrderIds, []);
  assert.deepEqual(getSyrveOrderIdsToObserve(resolved), [[]]);
});

test('newer usable association elsewhere resolves unassociated discovery without occupying this physical table', () => {
  const unknown = observe(opened(), [row(ORDER), pending(ORDER2, 500)]).state;
  const resolved = observe(unknown, [row(ORDER, 'Closed', 600), row(ORDER2, 'New', 501, [TABLE2])]).state;
  assert.deepEqual(resolved.activeSyrveOrderIds, []);
  assert.equal(resolved.lastSyrveState, 'closed'); assert.equal(status(resolved), 'free');
  assert.deepEqual(getSyrveOrderIdsToObserve(resolved), [[]]);
});

for (const kind of ['unknown_status', 'offline_group', 'group_mismatch']) {
  test(`new ${kind} tombstone outcome blocks peer closure in that same observation`, () => {
    let state = opened(row(ORDER), row(ORDER2));
    state = observe(state, [row(ORDER, 'Closed', 200), row(ORDER2, 'New', 200)]).state;
    state = staff(state).state;
    const group2 = id(5), changed = row(ORDER, kind === 'unknown_status' ? 'FutureStatus' : 'New', 300, [TABLE2]);
    const overrides = {};
    if (kind !== 'unknown_status') {
      changed.order.terminalGroupId = kind === 'offline_group' ? group2 : GROUP;
      Object.assign(overrides, {
        terminalGroups: { active: [{ id: GROUP }, { id: group2 }], sleeping: [] },
        catalogTables: [{ id: TABLE, terminalGroupId: GROUP, isDeleted: false },
          { id: TABLE2, terminalGroupId: group2, isDeleted: false }],
        availability: [{ terminalGroupId: GROUP, isAlive: true }, { terminalGroupId: group2, isAlive: kind !== 'offline_group' }],
      });
    }
    const value = probe([changed, row(ORDER2, 'Closed', 300)], overrides);
    const result = observe(state, [], { probe: value });
    assert.deepEqual(result.state.activeSyrveOrderIds, [ORDER2]);
    assert.deepEqual(result.state.manuallyFreedSyrveOrderIds, [ORDER2]);
    assert.deepEqual(getSyrveOrderIdsToObserve(result.state), [[ORDER, ORDER2]]);
    assert.ok(result.diagnostics.includes('unknown_orders'));
    const resolved = observe(result.state, [row(ORDER, 'New', 301, [TABLE2]), row(ORDER2, 'Closed', 300)]).state;
    assert.deepEqual(resolved.activeSyrveOrderIds, []); assert.deepEqual(resolved.manuallyFreedSyrveOrderIds, []);
  });
}

test('matching fingerprint at the same version cannot resolve a stored unknown classification', () => {
  let state = opened(row(ORDER), row(ORDER2));
  state = observe(state, [row(ORDER, 'Closed', 200), row(ORDER2, 'New', 200)]).state;
  state = staff(state).state;
  state.orderVersions.find((version) => version.id === ORDER).state = 'unknown';
  const blocked = observe(state, [row(ORDER, 'Closed', 200), row(ORDER2, 'Closed', 300)]).state;
  assert.deepEqual(blocked.activeSyrveOrderIds, [ORDER2]);
  assert.deepEqual(blocked.manuallyFreedSyrveOrderIds, [ORDER2]);
  const resolved = observe(blocked, [row(ORDER, 'Closed', 201), row(ORDER2, 'Closed', 300)]).state;
  assert.deepEqual(resolved.activeSyrveOrderIds, []);
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
  assert.deepEqual(getSyrveOrderIdsToObserve(freed), [[ORDER, ORDER2]]);
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

function largeState(count, unknown = false) {
  const state = opened(), version = state.orderVersions[0];
  const orderIds = Array.from({ length: count }, (_, index) => id(100000 + index));
  return { ...state, lastSyrveState: unknown ? 'unknown' : 'open',
    activeSyrveOrderIds: unknown ? [] : orderIds,
    manuallyFreedSyrveOrderIds: unknown ? [] : [...orderIds],
    orderVersions: orderIds.map((orderId) => ({ ...version, id: orderId,
      state: unknown ? 'unknown' : 'open', fingerprint: unknown ? null : version.fingerprint })) };
}

for (const count of [2100, 4201]) {
  test(`bounded observation plan resolves all ${count} tracked UUIDs through the actual mocked client`, async (t) => {
    const oldAppId = process.env.SYRVE_APP_ID, oldSecret = process.env.SYRVE_APP_CLIENT_SECRET;
    process.env.SYRVE_APP_ID = ''; process.env.SYRVE_APP_CLIENT_SECRET = '';
    t.after(() => {
      for (const [key, value] of [['SYRVE_APP_ID', oldAppId], ['SYRVE_APP_CLIENT_SECRET', oldSecret]]) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    });
    const calls = [];
    t.mock.method(globalThis, 'fetch', async (url, options) => {
      const path = new URL(url).pathname, body = JSON.parse(options.body);
      calls.push({ path, body });
      const payloads = {
        '/api/1/access_token': { token: 'state-policy-test-token' },
        '/api/1/organizations': { organizations: [{ id: ORG, name: 'MOLO' }] },
        '/api/1/terminal_groups': { terminalGroups: [{ organizationId: ORG,
          items: [{ id: GROUP, organizationId: ORG, name: 'Каса' }] }], terminalGroupsInSleep: [] },
        '/api/1/reserve/available_restaurant_sections': { restaurantSections: [{ id: id(98), name: 'Зал',
          terminalGroupId: GROUP, tables: [{ id: TABLE, number: 12, name: 'Стіл', isDeleted: false }] }] },
        '/api/1/terminal_groups/is_alive': { correlationId: id(99),
          isAliveStatus: [{ organizationId: ORG, terminalGroupId: GROUP, isAlive: true }] },
        '/api/1/order/by_table': { correlationId: id(99), orders: [] },
        '/api/1/order/by_id': { correlationId: id(99), orders: (body.orderIds || []).map((orderId) => row(orderId, 'Closed', 200)) },
      };
      assert.ok(path in payloads, `unexpected mocked read: ${path}`);
      return Response.json(payloads[path]);
    });
    const state = freeze(largeState(count)), plan = getSyrveOrderIdsToObserve(state);
    const client = new SyrveClient(), batches = [];
    for (const orderIds of plan) {
      const value = await client.probeOrders('https://api-eu.syrve.live', 'state-policy-test-login', ORG, [TABLE], orderIds);
      assert.equal(value.checks.ordersById.status, 'ok', 'every bounded by-ID read must succeed');
      assert.ok(orderIds.length <= 2000);
      batches.push({ orderIds, probe: value });
    }
    assert.equal(batches.length, Math.ceil(count / 2000));
    const result = reduceSyrveOrderState(state, { ...fence(state), probe: batches, visibilityVerified: true });
    assert.deepEqual(result.state.activeSyrveOrderIds, []);
    assert.deepEqual(result.state.manuallyFreedSyrveOrderIds, []);
    assert.equal(result.state.lastSyrveState, 'closed');
    assert.equal(result.state.orderVersions.length, count);
    assert.ok(result.state.orderVersions.every((version) => version.state === 'closed' && version.timestamp === 200));
    const fetched = calls.filter((call) => call.path === '/api/1/order/by_id').flatMap((call) => call.body.orderIds);
    assert.deepEqual(fetched.sort(), state.activeSyrveOrderIds);
    assert.ok(calls.filter((call) => call.path === '/api/1/order/by_id').every((call) => call.body.orderIds.length <= 200));
  });
}

function batchEvidence(state, makeRow = (orderId) => row(orderId, 'Closed', 200)) {
  return getSyrveOrderIdsToObserve(state).map((orderIds) => ({ orderIds,
    probe: probe(orderIds.map(makeRow).filter(Boolean)) }));
}
function observeBatches(state, batches = batchEvidence(state), overrides = {}) {
  return reduceSyrveOrderState(state, { ...fence(state), probe: batches, visibilityVerified: true, ...overrides });
}

test('bounded plan includes suppressed active and unknown tombstones exactly once without mutable aliases', () => {
  const state = largeState(2100), unknownIds = [id(110000), id(110001)];
  state.orderVersions.push(...unknownIds.map((orderId) => ({ id: orderId, timestamp: 300, state: 'unknown', fingerprint: null })),
    { ...state.orderVersions[0], id: id(120000), state: 'closed' });
  const before = structuredClone(state), plan = getSyrveOrderIdsToObserve(freeze(state));
  assert.deepEqual(plan.map((batch) => batch.length), [2000, 102]);
  assert.deepEqual(plan.flat(), [...state.activeSyrveOrderIds, ...unknownIds].sort());
  plan[0].pop(); plan.push([ORDER]);
  assert.deepEqual(state, before);
  assert.deepEqual(getSyrveOrderIdsToObserve(initial()), [[]]);
});

test('all 2100 unresolved inactive UUIDs are reachable and resolve without inventing occupancy or a closed table', () => {
  const state = largeState(2100, true), result = observeBatches(state);
  assert.deepEqual(result.state.activeSyrveOrderIds, []);
  assert.equal(result.state.lastSyrveState, 'unknown');
  assert.ok(result.state.orderVersions.every((version) => version.state === 'closed' && version.timestamp === 200));
  assert.deepEqual(getSyrveOrderIdsToObserve(result.state), [[]]);
});

test('failed by-ID evidence for inactive unknown tombstones cannot bypass the required-read gate', () => {
  const state = largeState(2100, true), batches = batchEvidence(state);
  batches[1].probe.checks.ordersById = { status: 'error', code: 'SYRVE_UNAVAILABLE' };
  const result = observeBatches(state, batches);
  assert.equal(result.changed, false); assert.deepEqual(result.state, state);
  assert.deepEqual(result.diagnostics, ['observation_unknown']);
});

for (const [name, mutate, diagnostic = 'observation_unknown'] of [
  ['omitted final batch', (batches) => batches.pop()],
  ['omitted unresolved scope', (batches) => batches[1].orderIds.pop()],
  ['duplicated first scope', (batches) => batches[1] = structuredClone(batches[0])],
  ['failed later by-ID read', (batches) => batches[1].probe.checks.ordersById = { status: 'error', code: 'SYRVE_UNAVAILABLE' }],
  ['absent later by-ID channel', (batches) => batches[1].probe.byId = null],
  ['offline later POS', (batches) => batches[1].probe.availability[0].isAlive = false],
  ['foreign later organization', (batches) => batches[1].probe.organizationId = id(90), 'scope_changed'],
]) {
  test(`${name} preserves the entire saved state before any batch closure or version update`, () => {
    const state = freeze(largeState(2100)), batches = batchEvidence(state), before = structuredClone(state);
    mutate(batches);
    const result = observeBatches(state, batches);
    assert.equal(result.changed, false); assert.deepEqual(result.state, before);
    assert.deepEqual(result.diagnostics, [diagnostic]); assert.deepEqual(state, before);
  });
}

for (const missing of [false, true]) {
  test(`${missing ? 'missing' : 'unknown'} order in a later batch fences every other closure and override deletion`, () => {
    const state = largeState(2100), last = state.activeSyrveOrderIds.at(-1);
    const batches = batchEvidence(state, (orderId) => orderId !== last ? row(orderId, 'Closed', 200)
      : missing ? null : pending(orderId, 300));
    const result = observeBatches(state, batches);
    assert.deepEqual(result.state.activeSyrveOrderIds, state.activeSyrveOrderIds);
    assert.deepEqual(result.state.manuallyFreedSyrveOrderIds, state.manuallyFreedSyrveOrderIds);
    assert.ok(result.diagnostics.includes('unknown_orders'));
    const resolved = observeBatches(result.state, batchEvidence(result.state, (orderId) => row(orderId, 'Closed', 400)));
    assert.deepEqual(resolved.state.activeSyrveOrderIds, []);
    assert.deepEqual(resolved.state.manuallyFreedSyrveOrderIds, []);
  });
}

test('equal-version conflicts across independent probes still fence the complete closure set', () => {
  const state = largeState(2100), batches = batchEvidence(state), first = state.activeSyrveOrderIds[0];
  batches[1].probe.byTable.push(...probe([row(first, 'New', 200)]).byTable);
  const result = observeBatches(state, batches);
  assert.deepEqual(result.state.activeSyrveOrderIds, state.activeSyrveOrderIds);
  assert.deepEqual(result.state.manuallyFreedSyrveOrderIds, state.manuallyFreedSyrveOrderIds);
  assert.equal(result.state.orderVersions.find((version) => version.id === first).state, 'unknown');
  assert.ok(result.diagnostics.includes('unknown_orders'));
});

test('a current table moving POS groups between bounded probes cannot publish old-group closures', () => {
  const state = largeState(2100), batches = batchEvidence(state), nextGroup = id(90);
  const value = batches[1].probe;
  value.catalogTables[0].terminalGroupId = nextGroup;
  value.terminalGroups.active = [{ id: nextGroup }]; value.availability = [{ terminalGroupId: nextGroup, isAlive: true }];
  for (const orders of [value.byTable, value.byId]) for (const order of orders) order.terminalGroupId = nextGroup;
  const result = observeBatches(state, batches);
  assert.equal(result.changed, false); assert.deepEqual(result.state, state);
  assert.deepEqual(result.diagnostics, ['observation_unknown']);
});

test('a single bounded probe cannot partially apply a saved scope requiring multiple probes', () => {
  const state = largeState(2100), result = observe(state, [row(state.activeSyrveOrderIds[0], 'Closed', 200)]);
  assert.equal(result.changed, false); assert.deepEqual(result.state, state);
  assert.deepEqual(result.diagnostics, ['observation_unknown']);
});

test('staff changes fence a complete multi-probe reply before any evidence is consumed', () => {
  const state = largeState(2100), event = { ...fence(state), probe: batchEvidence(state), visibilityVerified: true };
  const current = staff(state, 'status_changed').state;
  const result = reduceSyrveOrderState(current, event);
  assert.equal(result.changed, false); assert.deepEqual(result.state, current);
  assert.deepEqual(result.diagnostics, ['local_revision_changed']);
});

test('unexpected by-ID UUID in a bounded batch fails with the fixed internal error and no saved mutation', () => {
  const state = largeState(2100), before = structuredClone(state), batches = batchEvidence(state);
  batches[1].probe.byId.push(...probe([row(ORDER, 'Closed', 200)]).byId);
  assert.throws(() => observeBatches(state, batches), SyrveStateValidationError);
  assert.deepEqual(state, before);
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
  ['missing watermark state', (s) => delete s.orderVersions[0].state],
  ['unmarked null conflict', (s) => s.orderVersions[0].fingerprint = null],
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
