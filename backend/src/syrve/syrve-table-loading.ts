import { createHash, createHmac, timingSafeEqual } from 'crypto';
import type { AuthUser } from '../auth/types/auth-user.type';
import type { SyrveOrderProbe } from './syrve-order-observer';
import { assessSyrvePosVersion } from './syrve-pos-version';

export const LOADING_TTL_MS = 5 * 60_000;
export const LOADING_MAX_TABLES = 100;
export const LOADING_MAX_GROUPS = 4;
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const uuid = (value: unknown): value is string => typeof value === 'string' && value.length === 36 && UUID.test(value);
export type TableLoadingPlan = { organizationId: string; groups: { terminalGroupId: string; tableIds: string[]; posVersion: string }[] };
export class SyrveLoadingValidationError extends Error {}
const invalid = (): never => { throw new SyrveLoadingValidationError(); };

export function tableLoadingPlan(probe: SyrveOrderProbe, ids: string[]): TableLoadingPlan {
  if (!uuid(probe.organizationId) || !ids.length || ids.length > LOADING_MAX_TABLES
    || ids.some(id => !uuid(id)) || new Set(ids).size !== ids.length
    || ['connection', 'terminalGroups', 'restaurantSections', 'posAvailability', 'ordersByTable']
      .some(key => probe.checks?.[key as keyof typeof probe.checks]?.status !== 'ok')
    || !['ok', 'not_checked'].includes(probe.checks?.ordersById?.status)) invalid();
  const groups = new Map<string, TableLoadingPlan['groups'][number]>();
  for (const id of [...ids].sort()) {
    const tables = (probe.catalogTables || []).filter(table => table.id === id);
    const table = tables.length === 1 && !tables[0].isDeleted ? tables[0] : null;
    const active = (probe.terminalGroups?.active || []).filter(group => group.id === table?.terminalGroupId);
    const alive = (probe.availability || []).filter(group => group.terminalGroupId === table?.terminalGroupId);
    if (!table || !uuid(table.terminalGroupId) || active.length !== 1 || alive.length !== 1 || !alive[0].isAlive
      || probe.terminalGroups?.sleeping.some(group => group.id === table.terminalGroupId)
      || assessSyrvePosVersion(active[0].posVersion).initialization !== 'supported') invalid();
    const group = groups.get(table.terminalGroupId) || { terminalGroupId: table.terminalGroupId,
      posVersion: active[0].posVersion!, tableIds: [] };
    group.tableIds.push(id); groups.set(group.terminalGroupId, group);
  }
  if (groups.size > LOADING_MAX_GROUPS) invalid();
  return { organizationId: probe.organizationId, groups: [...groups.values()].sort((a, b) => a.terminalGroupId.localeCompare(b.terminalGroupId)) };
}
export function loadingPlanFingerprint(plan: TableLoadingPlan) {
  return createHash('sha256').update(JSON.stringify(plan)).digest('hex');
}
export function loadingActor(actor?: AuthUser) {
  if (actor?.role !== 'owner' || typeof actor.sub !== 'string' || !actor.sub || actor.sub.length > 200
    || !Number.isSafeInteger(actor.directorSessionVersion) || actor.directorSessionVersion! < 0) invalid();
  return createHash('sha256').update(JSON.stringify([actor!.sub, actor!.directorSessionVersion])).digest('hex');
}
type LoadingProof = { expires: number; revision: string; local: string; upstream: string; actor: string };
function mac(key: Buffer, value: string) {
  return createHmac('sha256', key).update('molo-syrve-table-loading-v1\0' + value).digest('base64url');
}
export function issueLoadingProof(key: Buffer, input: Omit<LoadingProof, 'expires'>, now = Date.now()) {
  const expires = now + LOADING_TTL_MS;
  const payload = Buffer.from(JSON.stringify({ ...input, expires })).toString('base64url');
  return { proof: payload + '.' + mac(key, payload), expiresAt: new Date(expires).toISOString() };
}
export function verifyLoadingProof(key: Buffer, value: string, now = Date.now()): LoadingProof {
  try {
    if (typeof value !== 'string' || value.length > 1500 || !/^[\w-]+\.[\w-]+$/.test(value)) invalid();
    const [payload, signature] = value.split('.'), expected = mac(key, payload);
    if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) invalid();
    const proof = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as LoadingProof;
    if (!proof || !Number.isSafeInteger(proof.expires) || proof.expires <= now || proof.expires > now + LOADING_TTL_MS
      || !uuid(proof.revision) || [proof.local, proof.upstream, proof.actor].some(hash => typeof hash !== 'string' || hash.length !== 64 || !/^[a-f0-9]{64}$/.test(hash))) invalid();
    return proof;
  } catch { return invalid(); }
}

export function parseLoadingCorrelation(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const response = value as Record<string, unknown>;
  if (Object.keys(response).length !== 1 || !uuid(response.correlationId)) return invalid();
  return response.correlationId.toLowerCase();
}
export function parseLoadingCommand(value: unknown): 'Success' | 'InProgress' | 'Error' {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const response = value as Record<string, unknown>;
  if (response.state === 'Error') return 'Error'; // Deliberately discard exception/errorReason.
  if (Object.keys(response).length === 1 && (response.state === 'Success' || response.state === 'InProgress')) return response.state;
  return invalid();
}
