import type { SyrvePosVersionStatus } from './syrve-pos-version';
// Read-only evidence. No table status reducer, persistence or activation lives here.
export class SyrveOrderValidationError extends Error {}

export const TABLE_ORDER_BATCH_SIZE = 100;
export const ORDER_ID_BATCH_SIZE = 200;
export const MAX_CATALOG_TABLES = 2_000;
export const MAX_RESPONSE_ORDERS = 2_000;
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export type OrderStatus = 'New' | 'Bill' | 'Closed' | 'Deleted';
type UnknownReason = 'creation_in_progress' | 'creation_error' | 'unknown_order_status'
  | 'missing_order' | 'conflicting_order_versions' | 'unavailable_pos' | 'order_table_changed'
  | 'order_terminal_group_changed' | 'observation_failed' | 'missing_table' | 'deleted_table' | 'unverified_pos_visibility';
export type SyrveObservedOrder = {
  id: string;
  timestamp: number;
  status: OrderStatus | null;
  tableIds: string[];
  terminalGroupId: string | null;
  state: 'open' | 'closed' | 'unknown';
  reason: UnknownReason | null;
};
export type ObservationCheckName = 'connection' | 'terminalGroups' | 'restaurantSections'
  | 'posAvailability' | 'ordersByTable' | 'ordersById';
export type ObservationCheck = { status: 'ok' | 'error' | 'not_checked'; code: string | null };
export type SyrveOrderProbe = {
  organizationId: string;
  startedAt: string;
  completedAt: string;
  authentication: 'v2' | 'legacy_v1' | null;
  checks: Record<ObservationCheckName, ObservationCheck>;
  terminalGroups: { active: { id: string; posVersion?: string | null; posVersionStatus?: SyrvePosVersionStatus }[];
    sleeping: { id: string; posVersion?: string | null; posVersionStatus?: SyrvePosVersionStatus }[] } | null;
  catalogTables: { id: string; terminalGroupId: string; isDeleted: boolean }[] | null;
  availability: { terminalGroupId: string; isAlive: boolean }[] | null;
  byTable: SyrveObservedOrder[] | null;
  byId: SyrveObservedOrder[] | null;
};
export type OrderObservationLink = {
  moloTableId: string;
  syrveTableId: string;
  activeSyrveOrderIds: string[];
};

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SyrveOrderValidationError();
  return value as Record<string, unknown>;
}
function array(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) throw new SyrveOrderValidationError();
  return value;
}
function uuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new SyrveOrderValidationError();
  return value.toLowerCase();
}
export function observationIds(value: unknown, maximum: number): string[] {
  const values = array(value, maximum).map(uuid);
  if (new Set(values).size !== values.length) throw new SyrveOrderValidationError();
  return values;
}

export function parsePosAvailability(payload: unknown, organizationId: string, groupIds: string[]) {
  const data = record(payload);
  uuid(data.correlationId);
  const seen = new Set<string>();
  const result = array(data.isAliveStatus, 100).map((raw) => {
    const item = record(raw);
    const terminalGroupId = uuid(item.terminalGroupId);
    if (uuid(item.organizationId) !== organizationId || !groupIds.includes(terminalGroupId)
        || seen.has(terminalGroupId) || typeof item.isAlive !== 'boolean') throw new SyrveOrderValidationError();
    seen.add(terminalGroupId);
    return { terminalGroupId, isAlive: item.isAlive };
  });
  // Omission is not an "alive" result. Reject a partial response atomically.
  if (seen.size !== groupIds.length) throw new SyrveOrderValidationError();
  return result;
}

export function parseSyrveOrders(payload: unknown, organizationId: string,
  scope: { tableIds: string[] } | { orderIds: string[] }): SyrveObservedOrder[] {
  const data = record(payload);
  uuid(data.correlationId);
  const seen = new Set<string>();
  return array(data.orders, MAX_RESPONSE_ORDERS).map((raw): SyrveObservedOrder => {
    const wrapper = record(raw);
    const id = uuid(wrapper.id);
    if (uuid(wrapper.organizationId) !== organizationId || seen.has(id)
        || !Number.isSafeInteger(wrapper.timestamp) || (wrapper.timestamp as number) < 0
        || !['Success', 'InProgress', 'Error'].includes(wrapper.creationStatus as string)
        || ('orderIds' in scope && !scope.orderIds.includes(id))) throw new SyrveOrderValidationError();
    seen.add(id);
    const timestamp = wrapper.timestamp as number;
    if (wrapper.creationStatus !== 'Success') {
      // Never inspect/forward an error body or trust a status while creation is pending.
      return { id, timestamp, status: null, tableIds: [], terminalGroupId: null, state: 'unknown',
        reason: wrapper.creationStatus === 'Error' ? 'creation_error' : 'creation_in_progress' };
    }
    const order = record(wrapper.order);
    const tableIds = observationIds(order.tableIds, MAX_CATALOG_TABLES);
    const terminalGroupId = uuid(order.terminalGroupId);
    if (!tableIds.length || typeof order.status !== 'string' || !order.status || order.status.length > 40
        || ('tableIds' in scope && !tableIds.some((tableId) => scope.tableIds.includes(tableId)))) {
      throw new SyrveOrderValidationError();
    }
    const status = ['New', 'Bill', 'Closed', 'Deleted'].includes(order.status) ? order.status as OrderStatus : null;
    return { id, timestamp, status, tableIds, terminalGroupId,
      state: status === 'New' || status === 'Bill' ? 'open' : status ? 'closed' : 'unknown',
      reason: status ? null : 'unknown_order_status' };
  });
}

export function mergeSyrveOrders(...batches: SyrveObservedOrder[][]): SyrveObservedOrder[] {
  const result = new Map<string, SyrveObservedOrder>();
  for (const order of batches.flat()) {
    const previous = result.get(order.id);
    if (!previous || order.timestamp > previous.timestamp) result.set(order.id, order);
    else if (order.timestamp === previous.timestamp &&
        (order.status !== previous.status || order.state !== previous.state || order.reason !== previous.reason
          || order.terminalGroupId !== previous.terminalGroupId
          || JSON.stringify([...order.tableIds].sort()) !== JSON.stringify([...previous.tableIds].sort()))) {
      result.set(order.id, { ...previous, status: null, state: 'unknown', reason: 'conflicting_order_versions' });
    }
  }
  return [...result.values()].sort((a, b) => a.id.localeCompare(b.id));
}

const CHECK_REQUIREMENTS = {
  connection: { permission: 'Data: dictionaries', minimumPosVersion: null },
  terminalGroups: { permission: 'Data: dictionaries', minimumPosVersion: null },
  restaurantSections: { permission: 'Orders: preparing', minimumPosVersion: '7.1.5' },
  posAvailability: { permission: 'POS: availability', minimumPosVersion: null },
  ordersByTable: { permission: 'Orders: receiving', minimumPosVersion: '7.4.6' },
  ordersById: { permission: 'Orders: receiving', minimumPosVersion: '7.4.6' },
} as const;

export function buildSyrveOrderObservation(probe: SyrveOrderProbe, links: OrderObservationLink[]) {
  const alive = new Set((probe.availability || []).filter((item) => item.isAlive).map((item) => item.terminalGroupId));
  const sleeping = new Set((probe.terminalGroups?.sleeping || []).map((item) => item.id));
  const catalog = new Map((probe.catalogTables || []).map((table) => [table.id, table]));
  const tracked = new Set(links.flatMap((link) => link.activeSyrveOrderIds));
  const allReadsValid = ['connection', 'terminalGroups', 'restaurantSections', 'posAvailability', 'ordersByTable']
    .every((key: ObservationCheckName) => probe.checks[key].status === 'ok')
    && (!tracked.size || probe.checks.ordersById.status === 'ok');
  const orders = mergeSyrveOrders(probe.byTable || [], probe.byId || []).map((order): SyrveObservedOrder => {
    if (!allReadsValid) return { ...order, status: null, state: 'unknown', reason: 'observation_failed' };
    if (!order.terminalGroupId || !alive.has(order.terminalGroupId)) {
      return { ...order, state: 'unknown', reason: order.reason || 'unavailable_pos' };
    }
    if (order.tableIds.some((id) => catalog.has(id) && catalog.get(id)!.terminalGroupId !== order.terminalGroupId)) {
      return { ...order, state: 'unknown', reason: 'order_terminal_group_changed' };
    }
    return order;
  });
  const tables = links.map((link) => {
    const table = catalog.get(link.syrveTableId);
    const usable = Boolean(allReadsValid && table && !table.isDeleted && alive.has(table.terminalGroupId));
    const associated = orders.filter((order) => order.tableIds.includes(link.syrveTableId));
    const activeOrderIds = usable ? associated.filter((order) => order.state === 'open').map((order) => order.id) : [];
    const explicitlyClosedOrderIds = usable ? associated.filter((order) => order.state === 'closed').map((order) => order.id) : [];
    const unknown = new Map<string, UnknownReason>();
    for (const order of associated) {
      if (!usable || order.state === 'unknown') unknown.set(order.id, order.reason || 'observation_failed');
    }
    for (const id of link.activeSyrveOrderIds) {
      if (activeOrderIds.includes(id) || explicitlyClosedOrderIds.includes(id)) continue;
      const order = orders.find((item) => item.id === id);
      unknown.set(id, !usable ? 'observation_failed' : !order ? 'missing_order'
        : order.reason || (order.tableIds.includes(link.syrveTableId) ? 'observation_failed' : 'order_table_changed'));
    }
    const reason: UnknownReason | null = activeOrderIds.length ? null : !probe.catalogTables ? 'observation_failed'
      : !table ? 'missing_table' : table.isDeleted ? 'deleted_table'
        : probe.checks.posAvailability.status !== 'ok' ? 'observation_failed'
          : !alive.has(table.terminalGroupId) ? 'unavailable_pos'
            : !allReadsValid ? 'observation_failed' : 'unverified_pos_visibility';
    // Explicit order closure is evidence about that UUID, not proof that a table is free.
    return { moloTableId: link.moloTableId, syrveTableId: link.syrveTableId,
      state: activeOrderIds.length ? 'open' as const : 'unknown' as const, reason,
      activeOrderIds, explicitlyClosedOrderIds,
      unknownOrders: [...unknown].map(([id, reason]) => ({ id, reason })), complete: false as const };
  });
  const warnings = [
    'Це лише перевірка читання. Статуси столів, бронювання та збережені дані не змінюються.',
    'Повноту видимості замовлень, створених на касі, ще не підтверджено. Синхронізацію ввімкнути неможливо.',
    'Порожня відповідь або зникнення замовлення не підтверджує його закриття. Bill означає виставлений рахунок.',
    'Версію POS неможливо підтвердити цією перевіркою. Для читання замовлень потрібна версія від 7.4.6.',
  ];
  if (sleeping.size) warnings.push('Частина касових груп спить. Їх не активовано, стан пов’язаних столів невідомий.');
  if (probe.availability?.some((item) => !item.isAlive)) warnings.push('Частина кас недоступна. Закриття замовлень на них не підтверджено.');
  if (!allReadsValid) warnings.push('Перевірка неповна. Збережений стан замовлень потрібно залишити без змін.');
  return {
    organizationId: probe.organizationId, startedAt: probe.startedAt, checkedAt: probe.completedAt,
    authentication: probe.authentication,
    checks: Object.fromEntries(Object.entries(probe.checks).map(([key, check]) =>
      [key, { ...check, ...CHECK_REQUIREMENTS[key as ObservationCheckName] }])),
    terminalGroups: [...probe.terminalGroups?.active || [], ...probe.terminalGroups?.sleeping || []].map((group) => ({
      id: group.id, state: sleeping.has(group.id) ? 'sleeping' as const : alive.has(group.id) ? 'alive' as const
        : probe.checks.posAvailability.status === 'ok' ? 'offline' as const : 'unknown' as const,
    })),
    orders, tables,
    diagnostics: { complete: false as const, posOrderVisibility: 'not_verified' as const,
      initializationPerformed: false as const, posVersion: 'not_verified' as const, warnings },
    activationReady: false as const, syncEnabled: false as const,
    statusesApplied: false as const, renamingApplied: false as const,
  };
}
