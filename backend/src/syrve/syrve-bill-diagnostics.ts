import { observationIds, SyrveOrderValidationError } from './syrve-order-observer';
import type { SyrvePosVersionStatus } from './syrve-pos-version';

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export type SyrveBillRecord = {
  id: string; posId: string | null; timestamp: number;
  creationStatus: 'Success' | 'InProgress' | 'Error';
  number: number | null; sum: number | null; status: 'New' | 'Bill' | 'Closed' | 'Deleted' | 'Unknown' | null;
  terminalGroupId: string | null; tableIds: string[];
};
export type SyrveBillPosLoading = {
  terminalGroupId: string; terminalGroupName: string; correlationId: string; requestAccepted: true;
};
export type SyrveBillReadResult = {
  startedAt: string; checkedAt: string; lookup: 'posId' | 'orderId' | null;
  order: SyrveBillRecord | null; posLoading?: SyrveBillPosLoading;
};
export type SyrveBillRegister = {
  id: string; name: string; posVersion: string | null; posVersionStatus: SyrvePosVersionStatus; loadingSupported: boolean;
};
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SyrveOrderValidationError();
  return value as Record<string, unknown>;
}
function uuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new SyrveOrderValidationError();
  return value.toLowerCase();
}

// POS UUIDs and Cloud UUIDs are distinct request selectors. Do not run a POS
// response through the worker parser's Cloud orderIds fence or forward bodies.
export function parseSyrveBill(payload: unknown, organizationId: string, requestedId: string,
  lookup: 'posId' | 'orderId'): SyrveBillRecord | null {
  const data = record(payload);
  uuid(data.correlationId);
  if (!Array.isArray(data.orders) || data.orders.length > 1) throw new SyrveOrderValidationError();
  if (!data.orders.length) return null;
  const wrapper = record(data.orders[0]), id = uuid(wrapper.id);
  const posId = wrapper.posId == null ? null : uuid(wrapper.posId);
  if (uuid(wrapper.organizationId) !== organizationId || !Number.isSafeInteger(wrapper.timestamp)
    || (wrapper.timestamp as number) < 0 || !['Success', 'InProgress', 'Error'].includes(wrapper.creationStatus as string)
    || (lookup === 'orderId' ? id !== requestedId : posId !== null ? posId !== requestedId : id !== requestedId)) throw new SyrveOrderValidationError();
  const base = { id, posId, timestamp: wrapper.timestamp as number,
    creationStatus: wrapper.creationStatus as SyrveBillRecord['creationStatus'] };
  if (base.creationStatus !== 'Success') return { ...base, number: null, sum: null, status: null, terminalGroupId: null, tableIds: [] };
  const order = record(wrapper.order);
  const sum = order.sum == null ? null : order.sum;
  const tableIds = observationIds(order.tableIds, 1000), terminalGroupId = uuid(order.terminalGroupId);
  if (!Number.isInteger(order.number) || (order.number as number) < 0 || (order.number as number) > 2147483647
    || (sum !== null && (typeof sum !== 'number' || !Number.isFinite(sum) || sum < 0))
    || typeof order.status !== 'string' || !order.status || order.status.length > 40) throw new SyrveOrderValidationError();
  const status = ['New', 'Bill', 'Closed', 'Deleted'].includes(order.status)
    ? order.status as SyrveBillRecord['status'] : 'Unknown';
  return { ...base, number: order.number as number, sum: sum as number | null, status, terminalGroupId, tableIds };
}
