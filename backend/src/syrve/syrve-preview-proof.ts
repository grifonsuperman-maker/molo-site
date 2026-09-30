import { BadRequestException } from '@nestjs/common';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import type { SyrveCatalog } from './syrve-catalog';
import type { SyrveSettingsVersion } from './syrve-settings.store';

export type SyrvePreviewProof = { expires: number; version: SyrveSettingsVersion; fingerprint: string;
  organizationId: string; credentials: string };
const TTL = 5 * 60_000;
const invalid = () => new BadRequestException('Перевірка столів застаріла або недійсна. Перевірте столи ще раз.');
const mac = (key: Buffer, value: string) => createHmac('sha256', key).update(`molo-syrve-preview-v1\0${value}`).digest();
export function credentialFingerprint(key: Buffer, base: string, login: string) {
  return mac(key, `credentials\0${base}\0${login}`).toString('hex');
}
export function previewFingerprint(catalog: SyrveCatalog, tables: { id: string; tableNumber: string }[],
  links: { integrationId: string; organizationId: string; moloTableId: string; syrveTableId: string }[]) {
  const sorted = (values: unknown[]) => values.map((value) => JSON.stringify(value)).sort();
  return createHash('sha256').update(JSON.stringify({
    organization: catalog.organization,
    groups: { active: sorted(catalog.terminalGroups.active), sleeping: sorted(catalog.terminalGroups.sleeping) },
    sectionsCount: catalog.sectionsCount,
    tables: sorted(catalog.tables), molo: sorted(tables.map(({ id, tableNumber }) => ({ id, tableNumber }))),
    links: sorted(links.map(({ integrationId, organizationId, moloTableId, syrveTableId }) =>
      ({ integrationId, organizationId, moloTableId, syrveTableId }))),
  })).digest('hex');
}
export function issuePreviewProof(key: Buffer, input: Omit<SyrvePreviewProof, 'expires'>) {
  const proof: SyrvePreviewProof = { ...input, expires: Date.now() + TTL };
  const payload = Buffer.from(JSON.stringify(proof)).toString('base64url');
  return { proof: `${payload}.${mac(key, payload).toString('base64url')}`, expiresAt: new Date(proof.expires).toISOString() };
}
export function verifyPreviewProof(key: Buffer, value: string): SyrvePreviewProof {
  try {
    if (typeof value !== 'string' || value.length > 2500) throw invalid();
    const [payload, signature, extra] = value.split('.');
    const provided = Buffer.from(signature || '', 'base64url');
    const expected = mac(key, payload);
    if (extra !== undefined || provided.length !== expected.length || !timingSafeEqual(provided, expected)) throw invalid();
    const proof = JSON.parse(Buffer.from(payload, 'base64url').toString()) as SyrvePreviewProof;
    if (!Number.isFinite(proof.expires) || proof.expires <= Date.now() || proof.expires > Date.now() + TTL ||
        !proof.version || typeof proof.organizationId !== 'string' || typeof proof.credentials !== 'string' ||
        typeof proof.fingerprint !== 'string') throw invalid();
    return proof;
  } catch { throw invalid(); }
}
