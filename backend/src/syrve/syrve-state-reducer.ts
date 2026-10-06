import { createHash } from 'crypto';
import type { TableStatus } from '../tables/entities/table.entity';
import type { SyrveTableState } from './entities/syrve-table-link.entity';
import { buildSyrveOrderObservation, MAX_RESPONSE_ORDERS, mergeSyrveOrders, observationIds } from './syrve-order-observer';
import type { SyrveObservedOrder, SyrveOrderProbe } from './syrve-order-observer';

// Pure policy only. No entity saves, API route, scheduler or activation wiring.
export type SyrveStateScope = {
  integrationId: string;
  configurationRevision: string;
  organizationId: string;
  moloTableId: string;
  syrveTableId: string;
};
export type SyrveOrderVersion = {
  id: string;
  timestamp: number;
  state: SyrveObservedOrder['state'];
  fingerprint: string | null;
};
export type SyrveTableSyncState = {
  scope: SyrveStateScope;
  localRevision: string;
  lastSyrveState: SyrveTableState;
  activeSyrveOrderIds: string[];
  manuallyFreedSyrveOrderIds: string[];
  // Includes closed tombstones and unknown high-water marks. Not a DB entity.
  orderVersions: SyrveOrderVersion[];
};
export type SyrveStateFence = {
  expectedScope: SyrveStateScope;
  expectedRevision: string;
  nextRevision: string;
  // Fresh connection/link scope under the future write lock; null if disconnected.
  currentScope: SyrveStateScope | null;
};
export type SyrveTransitionDiagnostic = 'scope_changed' | 'local_revision_changed' | 'observation_unknown'
  | 'visibility_not_verified' | 'unknown_orders' | 'stale_order' | 'conflicting_order_versions';
export type SyrveTransition = {
  state: SyrveTableSyncState;
  changed: boolean;
  diagnostics: SyrveTransitionDiagnostic[];
};
export type SyrveOrderObservationBatch = {
  // One independently bounded probe for this table and these saved UUIDs.
  orderIds: string[];
  probe: SyrveOrderProbe;
};
export class SyrveStateValidationError extends Error {
  constructor() { super('Invalid internal Syrve state'); }
}
const SCOPE_KEYS = ['integrationId', 'configurationRevision', 'organizationId', 'moloTableId', 'syrveTableId'] as const;
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

function uuid(value: string): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new SyrveStateValidationError();
  return value.toLowerCase();
}
function scope(value: SyrveStateScope): SyrveStateScope {
  if (!value) throw new SyrveStateValidationError();
  return Object.fromEntries(SCOPE_KEYS.map((key) => [key, uuid(value[key])])) as SyrveStateScope;
}
function sameScope(a: SyrveStateScope, b: SyrveStateScope) {
  return SCOPE_KEYS.every((key) => a[key] === b[key]);
}
function ids(value: string[]): string[] {
  try { return observationIds(value, Number.MAX_SAFE_INTEGER).sort(); }
  catch { throw new SyrveStateValidationError(); }
}
function copyState(value: SyrveTableSyncState): SyrveTableSyncState {
  if (!value || !Array.isArray(value.orderVersions)) throw new SyrveStateValidationError();
  const active = ids(value.activeSyrveOrderIds), freed = ids(value.manuallyFreedSyrveOrderIds);
  const versions = value.orderVersions.map((version) => {
    if (!version || !Number.isSafeInteger(version.timestamp) || version.timestamp < 0
      || !['open', 'closed', 'unknown'].includes(version.state)
      || (version.fingerprint === null && version.state !== 'unknown')
      || (version.fingerprint !== null && (typeof version.fingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(version.fingerprint)))) {
      throw new SyrveStateValidationError();
    }
    return { id: uuid(version.id), timestamp: version.timestamp, state: version.state, fingerprint: version.fingerprint };
  }).sort((a, b) => a.id.localeCompare(b.id));
  const versionIds = new Set(versions.map((version) => version.id)), activeIds = new Set(active);
  if (versionIds.size !== versions.length || active.some((id) => !versionIds.has(id))
    || freed.some((id) => !activeIds.has(id))
    || !['unknown', 'open', 'closed'].includes(value.lastSyrveState)
    || (value.lastSyrveState === 'open') !== Boolean(active.length)) throw new SyrveStateValidationError();
  return { scope: scope(value.scope), localRevision: uuid(value.localRevision), lastSyrveState: value.lastSyrveState,
    activeSyrveOrderIds: active, manuallyFreedSyrveOrderIds: freed, orderVersions: versions };
}

export function createSyrveTableSyncState(currentScope: SyrveStateScope, localRevision: string): SyrveTableSyncState {
  return { scope: scope(currentScope), localRevision: uuid(localRevision), lastSyrveState: 'unknown',
    activeSyrveOrderIds: [], manuallyFreedSyrveOrderIds: [], orderVersions: [] };
}

export function getSyrveOrderIdsToObserve(current: SyrveTableSyncState): string[][] {
  const state = copyState(current);
  // Suppressed active IDs and ambiguous tombstones still require by-ID evidence.
  const orderIds = [...new Set([...state.activeSyrveOrderIds,
    ...state.orderVersions.filter((version) => version.state === 'unknown').map((version) => version.id)])].sort();
  // A full saved set can exceed both the per-probe response and request budgets.
  // Each entry is a separate probeOrders call for this one physical table, not
  // merely another HTTP chunk inside one call. Empty state still needs discovery.
  return orderIds.length ? Array.from({ length: Math.ceil(orderIds.length / MAX_RESPONSE_ORDERS) }, (_, index) =>
    orderIds.slice(index * MAX_RESPONSE_ORDERS, (index + 1) * MAX_RESPONSE_ORDERS)) : [[]];
}

function fence(state: SyrveTableSyncState, event: SyrveStateFence): SyrveTransitionDiagnostic | null {
  const expected = scope(event.expectedScope);
  const expectedRevision = uuid(event.expectedRevision), nextRevision = uuid(event.nextRevision);
  if (!event.currentScope || !sameScope(state.scope, scope(event.currentScope)) || !sameScope(state.scope, expected)) {
    return 'scope_changed';
  }
  if (state.localRevision !== expectedRevision) return 'local_revision_changed';
  if (nextRevision === state.localRevision) throw new SyrveStateValidationError();
  return null;
}

function fingerprint(order: SyrveObservedOrder): string {
  // Provider versions are opaque integers, not dates. Only sanitized observer fields.
  return createHash('sha256').update(JSON.stringify([order.status, order.state, order.reason,
    order.terminalGroupId, [...order.tableIds].sort()])).digest('hex');
}

function validateOrder(order: SyrveObservedOrder) {
  uuid(order.id); ids(order.tableIds);
  if (order.terminalGroupId !== null) uuid(order.terminalGroupId);
  if (!Number.isSafeInteger(order.timestamp) || order.timestamp < 0
    || !['open', 'closed', 'unknown'].includes(order.state)
    || (order.status !== null && !['New', 'Bill', 'Closed', 'Deleted'].includes(order.status))
    || (order.state === 'open' && !['New', 'Bill'].includes(order.status))
    || (order.state === 'closed' && !['Closed', 'Deleted'].includes(order.status))) throw new SyrveStateValidationError();
}

function collectOrderEvidence(state: SyrveTableSyncState,
  input: SyrveOrderProbe | SyrveOrderObservationBatch[]): SyrveObservedOrder[] | null {
  const plan = getSyrveOrderIdsToObserve(state);
  const batches = Array.isArray(input) ? input : [{ orderIds: plan[0], probe: input }];
  // Never apply an early page, omit unresolved IDs, or feed an oversized saved
  // set back to the same bounded client call on every poll.
  if (batches.length !== plan.length) return null;
  const observations: SyrveObservedOrder[][] = [];
  let tableGroup: string | null = null;
  for (const [index, batch] of batches.entries()) {
    const requested = ids(batch.orderIds), probe = batch.probe;
    if (requested.length > MAX_RESPONSE_ORDERS) throw new SyrveStateValidationError();
    if (JSON.stringify(requested) !== JSON.stringify(plan[index])) return null;
    if (!probe || uuid(probe.organizationId) !== state.scope.organizationId) return null;
    if (!Array.isArray(probe.byTable) || probe.byTable.length > MAX_RESPONSE_ORDERS
      || (requested.length && (probe.checks.ordersById.status !== 'ok' || !Array.isArray(probe.byId)))
      || (probe.byId && probe.byId.length > MAX_RESPONSE_ORDERS)) return null;
    if (Array.isArray(input) && probe.byId?.some((order) => !requested.includes(uuid(order.id)))) {
      throw new SyrveStateValidationError();
    }
    const observation = buildSyrveOrderObservation(probe, [{ ...state.scope,
      activeSyrveOrderIds: state.activeSyrveOrderIds.filter((orderId) => requested.includes(orderId)) }]);
    if (observation.tables[0].reason !== null && observation.tables[0].reason !== 'unverified_pos_visibility') return null;
    const observedGroup = uuid(probe.catalogTables!.find((table) => table.id === state.scope.syrveTableId)!.terminalGroupId);
    if (tableGroup !== null && observedGroup !== tableGroup) return null;
    tableGroup = observedGroup;
    observation.orders.forEach(validateOrder);
    observations.push(observation.orders);
  }
  // Reconcile all reads before the existing whole-ledger closure gate. Equal
  // conflicts across probes remain unknown; a failed probe publishes no state.
  return mergeSyrveOrders(...observations);
}

export function reduceSyrveOrderState(current: SyrveTableSyncState, event: SyrveStateFence & {
  probe: SyrveOrderProbe | SyrveOrderObservationBatch[];
  // Server-established prerequisite, never a Director DTO flag. PR 6 cannot prove it.
  visibilityVerified: boolean;
}): SyrveTransition {
  const state = copyState(current), rejected = fence(state, event);
  const retained = (diagnostic: SyrveTransitionDiagnostic): SyrveTransition => ({ state, changed: false, diagnostics: [diagnostic] });
  if (rejected) return retained(rejected);
  if (typeof event.visibilityVerified !== 'boolean') throw new SyrveStateValidationError();
  const probes = Array.isArray(event.probe) ? event.probe.map((batch) => batch.probe) : [event.probe];
  if (probes.some((probe) => uuid(probe.organizationId) !== state.scope.organizationId)) return retained('scope_changed');
  const orders = collectOrderEvidence(state, event.probe);
  if (!orders) return retained('observation_unknown');

  const diagnostics = new Set<SyrveTransitionDiagnostic>();
  const active = new Set(state.activeSyrveOrderIds), freed = new Set(state.manuallyFreedSyrveOrderIds);
  const versions = new Map(state.orderVersions.map((version) => [version.id, version]));
  const associated = orders.filter((order) => order.tableIds.includes(state.scope.syrveTableId));
  const open = new Set(associated.filter((order) => order.state === 'open').map((order) => order.id));
  const closed = new Set(associated.filter((order) => order.state === 'closed').map((order) => order.id));
  const byId = probes.flatMap(probe => probe.byId || []);
  // An explicit newer by-ID record can end this table's association while the
  // bill remains open elsewhere. An empty read or an unverified move never does.
  const moved = new Set(orders.filter(order => {
    const previous = versions.get(order.id);
    return event.visibilityVerified && active.has(order.id) && previous
      && (order.timestamp > previous.timestamp || (order.timestamp === previous.timestamp
        && previous.state === 'closed' && previous.fingerprint === fingerprint(order)))
      && order.state !== 'unknown' && order.tableIds.length && !order.tableIds.includes(state.scope.syrveTableId)
      && byId.some(read => read.id === order.id && read.timestamp === order.timestamp && fingerprint(read) === fingerprint(order));
  }).map(order => order.id));
  // Missing/ambiguous orders cannot make a partial closure or transfer free a table.
  const unknownOrders = state.activeSyrveOrderIds.some((orderId) => !open.has(orderId) && !closed.has(orderId) && !moved.has(orderId)) || orders.some((order) =>
    order.state === 'unknown' && (!order.tableIds.length || order.tableIds.includes(state.scope.syrveTableId)));
  const candidates = orders
    .filter((order) => order.tableIds.includes(state.scope.syrveTableId) || active.has(order.id) || versions.has(order.id)
      || (order.state === 'unknown' && !order.tableIds.length))
    .map((order) => ({ order, previous: versions.get(order.id), signature: fingerprint(order),
      evidenceState: open.has(order.id) ? 'open' as const : closed.has(order.id) || moved.has(order.id)
        || (versions.has(order.id) && order.state !== 'unknown' && order.tableIds.length && !order.tableIds.includes(state.scope.syrveTableId)
          && !active.has(order.id)) ? 'closed' as const
        : !active.has(order.id) ? order.state : 'unknown' as const }));
  const accepted: typeof candidates = [];
  // Phase one derives the entire prospective ledger without changing membership
  // or overrides. This fences existing, newly unknown and equal-conflict records.
  for (const { order, previous, signature, evidenceState } of candidates) {
    if (previous && order.timestamp < previous.timestamp) { diagnostics.add('stale_order'); continue; }
    if (previous && order.timestamp === previous.timestamp && previous.fingerprint !== signature) {
      // A conflict remains fenced at this version; only a strictly newer version can resolve it.
      versions.set(order.id, { id: order.id, timestamp: order.timestamp, state: 'unknown', fingerprint: null });
      diagnostics.add('conflicting_order_versions');
      continue;
    }
    // Even an identical fingerprint cannot certify an unresolved stored outcome
    // at the same version. Only strictly newer usable evidence resolves it.
    if (previous?.state === 'unknown' && order.timestamp === previous.timestamp) continue;
    versions.set(order.id, { id: order.id, timestamp: order.timestamp, state: evidenceState, fingerprint: signature });
    accepted.push({ order, previous, signature, evidenceState });
  }
  const unresolved = [...versions.values()].filter((version) => version.state === 'unknown');
  if (unknownOrders || unresolved.length) diagnostics.add('unknown_orders');
  if (unresolved.some((version) => version.fingerprint === null)) diagnostics.add('conflicting_order_versions');
  if (!event.visibilityVerified) diagnostics.add('visibility_not_verified');
  const canClose = event.visibilityVerified === true && !unknownOrders && !unresolved.length;

  // Phase two applies membership only after every prospective outcome is known.
  for (const { order } of accepted) {
    if (open.has(order.id)) active.add(order.id);
    else if ((closed.has(order.id) || moved.has(order.id)) && canClose) { active.delete(order.id); freed.delete(order.id); }
    // Unknown versions advance the high-water mark but retain active IDs/overrides.
  }

  const next: SyrveTableSyncState = { ...state,
    activeSyrveOrderIds: [...active].sort(), manuallyFreedSyrveOrderIds: [...freed].sort(),
    orderVersions: [...versions.values()].sort((a, b) => a.id.localeCompare(b.id)),
    lastSyrveState: active.size ? 'open' : state.activeSyrveOrderIds.length && canClose ? 'closed' : state.lastSyrveState,
  };
  const changed = JSON.stringify(next) !== JSON.stringify(state);
  if (changed) next.localRevision = uuid(event.nextRevision);
  return { state: next, changed, diagnostics: [...diagnostics].sort() };
}

export function reduceSyrveStaffAction(current: SyrveTableSyncState, event: SyrveStateFence & {
  action: 'manual_free' | 'status_changed';
}): SyrveTransition {
  const state = copyState(current), rejected = fence(state, event);
  if (rejected) return { state, changed: false, diagnostics: [rejected] };
  if (!['manual_free', 'status_changed'].includes(event.action)) throw new SyrveStateValidationError();
  // Always rotate the fence, even before the first order or a change-and-restore.
  return { state: { ...state, localRevision: uuid(event.nextRevision),
    manuallyFreedSyrveOrderIds: event.action === 'manual_free'
      ? [...state.activeSyrveOrderIds] : [...state.manuallyFreedSyrveOrderIds] }, changed: true, diagnostics: [] };
}

// Runtime status changes are lifecycle events, not a continuously projected
// POS source. Legacy manual suppression IDs never veto a new opening/closure.
export function syrveTableStatusEvent(previous: SyrveTableSyncState, transition: SyrveTransition): 'occupied' | 'free' | null {
  if (!transition.changed || transition.diagnostics.some(code => ['scope_changed', 'local_revision_changed',
    'observation_unknown', 'visibility_not_verified'].includes(code))) return null;
  const before = copyState(previous), after = copyState(transition.state);
  if (!sameScope(before.scope, after.scope)) return null;
  const activeBefore = new Set(before.activeSyrveOrderIds);
  if (after.activeSyrveOrderIds.some(id => !activeBefore.has(id))) return 'occupied';
  if (before.activeSyrveOrderIds.length && !after.activeSyrveOrderIds.length && after.lastSyrveState === 'closed') return 'free';
  return null;
}

// Legacy pure projection retained for compatibility tests only. Runtime table
// reads must use the physical status committed by syrveTableStatusEvent.
export function projectSyrveTableStatus(state: SyrveTableSyncState | null, input: {
  currentScope: SyrveStateScope | null;
  syncEnabled: boolean;
  view: 'today' | 'future';
  hidden: boolean;
  zoneClosed: boolean;
  manualStatus: TableStatus;
  booking: 'none' | 'pending' | 'approved';
  checkedIn: boolean;
}): TableStatus | 'hidden' {
  if (!['free', 'pending', 'reserved', 'occupied', 'cleaning', 'closed'].includes(input.manualStatus)
    || !['none', 'pending', 'approved'].includes(input.booking) || !['today', 'future'].includes(input.view)
    || typeof input.syncEnabled !== 'boolean' || typeof input.hidden !== 'boolean' || typeof input.zoneClosed !== 'boolean'
    || typeof input.checkedIn !== 'boolean' || (input.checkedIn && input.booking !== 'approved')) throw new SyrveStateValidationError();
  if (input.hidden) return 'hidden';
  if (input.zoneClosed || input.manualStatus === 'closed') return 'closed';
  if (input.view === 'future') return input.booking === 'approved' ? 'reserved' : input.booking === 'pending' ? 'pending' : 'free';
  let posOccupied = false;
  if (input.syncEnabled && input.currentScope && state) {
    const current = copyState(state);
    const freed = new Set(current.manuallyFreedSyrveOrderIds);
    posOccupied = sameScope(current.scope, scope(input.currentScope)) && current.activeSyrveOrderIds
      .some((id) => !freed.has(id));
  }
  if (input.manualStatus === 'occupied' || input.checkedIn || posOccupied) return 'occupied';
  if (input.manualStatus === 'cleaning') return 'cleaning';
  if (input.manualStatus === 'reserved' || input.booking === 'approved') return 'reserved';
  if (input.manualStatus === 'pending' || input.booking === 'pending') return 'pending';
  return 'free';
}
