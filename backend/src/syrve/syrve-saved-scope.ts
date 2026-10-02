import { createHash } from 'crypto';
import type { TableEntity } from '../tables/entities/table.entity';
import { settingsVersion, type SyrveSettingsSnapshot } from './syrve-settings.store';

// Shared by read-only diagnostics and explicit loading. A staff action, mapping,
// credential change or physical-table change invalidates evidence fetched earlier.
export function savedSyrveFingerprint(current: SyrveSettingsSnapshot, rows: TableEntity[]) {
  return createHash('sha256').update(JSON.stringify({
    version: settingsVersion(current), prepared: current.prepared,
    connection: current.entity && [current.entity.status, current.entity.organizationId, current.entity.apiBaseUrl,
      current.entity.apiLoginEncrypted, current.entity.apiLoginIv, current.entity.apiLoginAuthTag],
    links: current.links.map(link => [link.id, link.integrationId, link.organizationId, link.moloTableId, link.syrveTableId,
      link.lastKnownNumber, link.lastSeenAt, link.lastSyncedAt, link.lastSyrveState,
      [...link.activeSyrveOrderIds].sort(), [...link.manuallyFreedSyrveOrderIds].sort(), link.updatedAt])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    tables: rows.filter(table => current.links.some(link => link.moloTableId === table.id))
      .map(table => [table.id, table.tableNumber, table.status, table.updatedAt] as const)
      .sort((a, b) => a[0].localeCompare(b[0])),
  })).digest('hex');
}
