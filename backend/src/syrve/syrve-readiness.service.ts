import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { readSyrveSchemaPreflight, schemaPreflight } from './syrve-schema-preflight';

export type SyrveReadinessCheck = { key: string; status: 'ok' | 'blocked' | 'not_checked'; code: string };
export function readinessResponse(facts: Awaited<ReturnType<typeof readSyrveSchemaPreflight>>) {
  const plan = schemaPreflight(facts), data = facts.data;
  const check = (key: string, valid: boolean, code: string): SyrveReadinessCheck => ({ key, status: valid ? 'ok' : 'blocked', code });
  return { syncEnabled: false as const, activationAvailable: false as const, configurationRevision: data?.configurationRevision || null, checkedAt: new Date().toISOString(),
    checks: [check('schema', plan.status === 'prepared', plan.status === 'prepared' ? 'SCHEMA_VERIFIED'
      : plan.status === 'plan_requires_review' ? 'SCHEMA_PENDING' : 'SCHEMA_REQUIRES_AUDIT'),
    check('connection', Boolean(data?.connected && data.credentials && data.integrationCount === 1), data?.connected && data.credentials ? 'CONNECTION_SAVED' : 'CONNECTION_REQUIRED'),
    check('mapping', Boolean(data?.linksValid && data.tablesUnambiguous), data?.linksValid && data.tablesUnambiguous ? 'MAPPING_VALID' : 'MAPPING_REQUIRED'),
    { key: 'state', status: data?.state === 'valid' ? 'ok' : data?.state === 'unobserved' ? 'not_checked' : 'blocked',
      code: data?.state === 'valid' ? 'STATE_VALID' : data?.state === 'unobserved' ? 'STATE_UNOBSERVED' : 'STATE_REQUIRES_AUDIT' },
    { key: 'orders', status: 'not_checked', code: 'ORDER_ACCESS_NOT_CHECKED' },
    { key: 'visibility', status: 'not_checked', code: 'POS_VISIBILITY_NOT_VERIFIED' },
    { key: 'activation', status: 'blocked', code: 'ACTIVATION_NOT_AVAILABLE' }] as SyrveReadinessCheck[] };
}

@Injectable()
export class SyrveReadinessService {
  constructor(private readonly source: DataSource) {}
  async read() {
    try { return readinessResponse(await readSyrveSchemaPreflight(this.source)); }
    catch { throw new ServiceUnavailableException('Не вдалося перевірити готовність Syrve. Оновіть перевірку пізніше.'); }
  }
}
