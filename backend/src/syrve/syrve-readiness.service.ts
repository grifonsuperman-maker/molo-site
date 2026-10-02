import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { readSyrveSchemaPreflight, schemaPreflight } from './syrve-schema-preflight';
import { SyrveActivationStore } from './syrve-activation.store';
import { SyrveSettingsStore } from './syrve-settings.store';

export type SyrveReadinessCheck = { key: string; status: 'ok' | 'blocked' | 'not_checked'; code: string };
export function readinessResponse(facts: Awaited<ReturnType<typeof readSyrveSchemaPreflight>>, enabled = false, available = false) {
  const plan = schemaPreflight(facts), data = facts.data;
  const check = (key: string, valid: boolean, code: string): SyrveReadinessCheck => ({ key, status: valid ? 'ok' : 'blocked', code });
  return { syncEnabled: enabled, activationAvailable: available, configurationRevision: data?.configurationRevision || null, checkedAt: new Date().toISOString(),
    checks: [check('schema', plan.status === 'prepared', plan.status === 'prepared' ? 'SCHEMA_VERIFIED'
      : plan.status === 'plan_requires_review' ? 'SCHEMA_PENDING' : 'SCHEMA_REQUIRES_AUDIT'),
    check('connection', Boolean(data?.connected && data.credentials && data.integrationCount === 1), data?.connected && data.credentials ? 'CONNECTION_SAVED' : 'CONNECTION_REQUIRED'),
    check('mapping', Boolean(data?.linksValid && data.tablesUnambiguous), data?.linksValid && data.tablesUnambiguous ? 'MAPPING_VALID' : 'MAPPING_REQUIRED'),
    { key: 'state', status: data?.state === 'valid' ? 'ok' : data?.state === 'unobserved' ? 'not_checked' : 'blocked',
      code: data?.state === 'valid' ? 'STATE_VALID' : data?.state === 'unobserved' ? 'STATE_UNOBSERVED' : 'STATE_REQUIRES_AUDIT' },
    { key: 'orders', status: 'not_checked', code: 'ORDER_ACCESS_NOT_CHECKED' },
    { key: 'visibility', status: 'not_checked', code: 'POS_VISIBILITY_NOT_VERIFIED' },
    { key: 'activation', status: enabled || available ? 'ok' : 'blocked', code: enabled ? 'ACTIVATION_ENABLED' : available ? 'ACTIVATION_AVAILABLE' : 'ACTIVATION_NOT_AVAILABLE' }] as SyrveReadinessCheck[] };
}

@Injectable()
export class SyrveReadinessService {
  constructor(private readonly source: DataSource) {}
  async read() {
    try {
      const facts = await readSyrveSchemaPreflight(this.source), settings = new SyrveSettingsStore(this.source), snapshot = await settings.read();
      if (facts.data?.configurationRevision !== (snapshot.entity?.configurationRevision || null)) throw new Error('Changed configuration');
      const active = await new SyrveActivationStore(this.source, settings).read(snapshot);
      const available = active.prepared && schemaPreflight(facts).status === 'prepared'
        && Boolean(facts.data?.connected && facts.data.credentials && facts.data.linksValid && facts.data.state !== 'invalid');
      return readinessResponse(facts, active.enabled, available);
    }
    catch { throw new ServiceUnavailableException('Не вдалося перевірити готовність Syrve. Оновіть перевірку пізніше.'); }
  }
}
