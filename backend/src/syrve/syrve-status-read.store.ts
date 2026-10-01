import { ServiceUnavailableException } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { TableEntity } from '../tables/entities/table.entity';
import { SyrveSettingsStore } from './syrve-settings.store';
import { getSyrveOrderIdsToObserve, SyrveStateScope, SyrveTableSyncState } from './syrve-state-reducer';

export type SyrveStatusEntry = {
  state: SyrveTableSyncState;
  currentScope: SyrveStateScope;
  physicalStatus: TableEntity['status'];
  physicalUpdatedAt: number;
};
export type SyrveStatusSnapshot = { syncEnabled: boolean; tables: ReadonlyMap<string, SyrveStatusEntry> };
export const disabledSyrveStatus = (): SyrveStatusSnapshot => ({ syncEnabled: false, tables: new Map() });
type SavedState = { link_id: string; integration_id: string; configuration_revision: string;
  organization_id: string; molo_table_id: string; syrve_table_id: string; local_revision: string };

// Internal preparation, not a provider/export or activation API. Unlike the
// transition store, this reader never creates/rebases state or takes write locks.
export class SyrveStatusReadStore {
  constructor(private readonly source: DataSource, private readonly settings: SyrveSettingsStore) {}

  private table(name: string) {
    const options = this.source.options;
    const schema = options.type === 'postgres' ? options.schema || 'public' : 'public';
    return '"' + schema.replace(/"/g, '""') + '"."' + name + '"';
  }

  async read(tableIds: string[]): Promise<SyrveStatusSnapshot> {
    const ids = [...new Set(tableIds.map((id) => id.toLowerCase()))];
    if (!ids.length) return disabledSyrveStatus();
    return this.source.transaction('REPEATABLE READ', async (manager) => {
      await manager.query('SET TRANSACTION READ ONLY');
      await manager.query("SET LOCAL statement_timeout = '5s'");
      const [storage] = await manager.query('SELECT to_regclass($1) IS NOT NULL AND to_regclass($2) IS NOT NULL AS prepared',
        [this.table('syrve_table_sync_states'), this.table('syrve_order_versions')]);
      if (!storage.prepared) return disabledSyrveStatus();
      const snapshot = await this.settings.read(manager);
      const entity = snapshot.entity;
      if (!snapshot.prepared || !entity?.configurationRevision || !entity.organizationId
        || !['connected', 'error'].includes(entity.status)) return disabledSyrveStatus();
      const requested = new Set(ids);
      const links = snapshot.links.filter((link) => requested.has(link.moloTableId)
        && link.integrationId === entity.id && link.organizationId === entity.organizationId);
      if (!links.length) return { syncEnabled: true, tables: new Map() };
      const linkIds = links.map((link) => link.id);
      const saved: SavedState[] = await manager.query('SELECT * FROM ' + this.table('syrve_table_sync_states')
        + ' WHERE "link_id"=ANY($1::uuid[])', [linkIds]);
      const versions = await manager.query('SELECT "link_id","order_id","timestamp","state","fingerprint" FROM '
        + this.table('syrve_order_versions') + ' WHERE "link_id"=ANY($1::uuid[]) ORDER BY "link_id","order_id"', [linkIds]);
      const physical = await manager.getRepository(TableEntity).find({
        where: { id: In(ids) }, select: { id: true, status: true, updatedAt: true },
      });
      const savedByLink = new Map<string, SavedState>(saved.map((value) => [value.link_id, value]));
      const physicalById = new Map(physical.map((value) => [value.id, value]));
      const versionsByLink = new Map<string, SyrveTableSyncState['orderVersions']>();
      for (const value of versions) {
        const entries = versionsByLink.get(value.link_id) || [];
        entries.push({ id: value.order_id, timestamp: Number(value.timestamp), state: value.state, fingerprint: value.fingerprint });
        versionsByLink.set(value.link_id, entries);
      }
      const result = new Map<string, SyrveStatusEntry>();
      for (const link of links) {
        const row = savedByLink.get(link.id);
        const table = physicalById.get(link.moloTableId);
        if (!table) continue;
        if (!row) {
          if (link.lastSyrveState !== 'unknown' || link.activeSyrveOrderIds.length || link.manuallyFreedSyrveOrderIds.length) {
            throw new ServiceUnavailableException('Збережений стан Syrve потребує перевірки. Спробуйте оновити карту пізніше.');
          }
          continue;
        }
        const currentScope: SyrveStateScope = { integrationId: entity.id, configurationRevision: entity.configurationRevision,
          organizationId: link.organizationId, moloTableId: link.moloTableId, syrveTableId: link.syrveTableId };
        // Read paths never adopt a new revision or repair a foreign binding.
        if (row.integration_id !== currentScope.integrationId || row.configuration_revision !== currentScope.configurationRevision
          || row.organization_id !== currentScope.organizationId || row.molo_table_id !== currentScope.moloTableId
          || row.syrve_table_id !== currentScope.syrveTableId) continue;
        const state: SyrveTableSyncState = { scope: currentScope, localRevision: row.local_revision,
          lastSyrveState: link.lastSyrveState, activeSyrveOrderIds: [...link.activeSyrveOrderIds],
          manuallyFreedSyrveOrderIds: [...link.manuallyFreedSyrveOrderIds],
          orderVersions: versionsByLink.get(link.id) || [] };
        try { getSyrveOrderIdsToObserve(state); }
        catch { throw new ServiceUnavailableException('Збережений стан Syrve потребує перевірки. Спробуйте оновити карту пізніше.'); }
        result.set(table.id, { state, currentScope, physicalStatus: table.status, physicalUpdatedAt: table.updatedAt.getTime() });
      }
      return { syncEnabled: true, tables: result };
    });
  }
}
