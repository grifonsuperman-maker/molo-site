import { createHash, createHmac, timingSafeEqual } from 'crypto';
import type { SyrveSettingsSnapshot } from './syrve-settings.store';
import { LOADING_MAX_GROUPS, LOADING_MAX_TABLES, LOADING_TTL_MS, type TableLoadingPlan } from './syrve-table-loading';
import { canAttemptSyrveInitialization } from './syrve-pos-version';

const uuid = (value: unknown): value is string => typeof value === 'string' && value.length === 36
  && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value);
const hash = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
export class SyrveActivationValidationError extends Error {}
const invalid = (): never => { throw new SyrveActivationValidationError(); };

export function activationPlan(value: unknown, snapshot: SyrveSettingsSnapshot): TableLoadingPlan {
  const plan = value as TableLoadingPlan;
  if (!plan || !uuid(plan.organizationId) || plan.organizationId !== snapshot.entity?.organizationId
    || !Array.isArray(plan.groups) || !plan.groups.length || plan.groups.length > LOADING_MAX_GROUPS) invalid();
  const groups = plan.groups.map(group => {
    if (!group || !uuid(group.terminalGroupId) || !Array.isArray(group.tableIds) || !group.tableIds.length
      || group.tableIds.some(id => !uuid(id)) || !canAttemptSyrveInitialization(group.posVersion, group.posVersionStatus)) invalid();
    return { terminalGroupId: group.terminalGroupId, posVersion: group.posVersion,
      ...(group.posVersion === null ? { posVersionStatus: group.posVersionStatus } : {}), tableIds: [...group.tableIds].sort() };
  }).sort((a, b) => a.terminalGroupId.localeCompare(b.terminalGroupId));
  const ids = groups.flatMap(group => group.tableIds);
  if (!ids.length || ids.length > LOADING_MAX_TABLES || new Set(ids).size !== ids.length
    || new Set(groups.map(group => group.terminalGroupId)).size !== groups.length
    || ids.length !== snapshot.links.length || snapshot.links.some(link => !ids.includes(link.syrveTableId))) invalid();
  return { organizationId: plan.organizationId, groups };
}

// Manual status/updatedAt and the cumulative ledger are intentionally excluded:
// staff actions must fence a pending observation without revoking Director consent.
export function activationBindings(snapshot: SyrveSettingsSnapshot, tables: { id: string; tableNumber: string }[]) {
  const entity = snapshot.entity;
  if (!snapshot.prepared || !entity || !uuid(entity.id) || !uuid(entity.configurationRevision) || !uuid(entity.organizationId)
    || !entity.apiLoginEncrypted || !entity.apiLoginIv || !entity.apiLoginAuthTag || !snapshot.links.length
    || new Set(snapshot.links.map(link => link.moloTableId)).size !== snapshot.links.length
    || new Set(snapshot.links.map(link => link.syrveTableId)).size !== snapshot.links.length
    || snapshot.links.some(link => !uuid(link.id) || link.integrationId !== entity.id || link.organizationId !== entity.organizationId
      || !uuid(link.moloTableId) || !uuid(link.syrveTableId) || tables.filter(table => table.id === link.moloTableId).length !== 1)) invalid();
  return createHash('sha256').update(JSON.stringify({
    id: entity.id, revision: entity.configurationRevision, organizationId: entity.organizationId,
    baseUrl: entity.apiBaseUrl, encrypted: entity.apiLoginEncrypted, iv: entity.apiLoginIv, tag: entity.apiLoginAuthTag,
    links: [...snapshot.links].sort((a,b) => a.id.localeCompare(b.id)).map(link => [link.id, link.moloTableId, link.syrveTableId,
      tables.find(table => table.id === link.moloTableId)!.tableNumber]),
  })).digest('hex');
}
type ActivationProof = { revision: string; local: string; upstream: string; actor: string; expires: number };
const mac = (key: Buffer, payload: string) => createHmac('sha256', key).update('molo-syrve-activation-v1\0' + payload).digest('base64url');
export function issueActivationProof(key: Buffer, input: Omit<ActivationProof, 'expires'>, now = Date.now()) {
  const expires = now + LOADING_TTL_MS, payload = Buffer.from(JSON.stringify({ ...input, expires })).toString('base64url');
  return { proof: payload + '.' + mac(key, payload), expiresAt: new Date(expires).toISOString() };
}
export function verifyActivationProof(key: Buffer, value: string, now = Date.now()): ActivationProof {
  try {
    if (typeof value !== 'string' || value.length > 1500 || !/^[\w-]+\.[\w-]+$/.test(value)) invalid();
    const [payload, signature] = value.split('.'), expected = mac(key, payload);
    if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) invalid();
    const proof = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as ActivationProof;
    if (!proof || !uuid(proof.revision) || ![proof.local, proof.upstream, proof.actor].every(hash)
      || !Number.isSafeInteger(proof.expires) || proof.expires <= now || proof.expires > now + LOADING_TTL_MS) invalid();
    return proof;
  } catch { return invalid(); }
}
