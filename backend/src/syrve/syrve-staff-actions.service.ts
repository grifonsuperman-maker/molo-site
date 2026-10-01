import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';

import { staleSyrveSettings, SyrveSettingsStore } from './syrve-settings.store';
import { SyrveStateStore } from './syrve-state.store';

@Injectable()
export class SyrveStaffActionsService {
  private readonly states: SyrveStateStore;

  constructor(private readonly dataSource: DataSource, private readonly settings: SyrveSettingsStore) {
    this.states = new SyrveStateStore(dataSource, settings);
  }

  async run<T>(moloTableId: string, action: 'manual_free' | 'status_changed',
    write: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.settings.localTransaction(async (manager) => {
      const options = this.dataSource.options;
      const schema = options.type === 'postgres' ? options.schema || 'public' : 'public';
      const qualified = (name: string) => '"' + schema.replace(/"/g, '""') + '"."' + name + '"';
      const [storage] = await manager.query('SELECT to_regclass($1) IS NOT NULL AND to_regclass($2) IS NOT NULL AS durable,'
        + ' to_regclass($3) IS NOT NULL AND to_regclass($4) IS NOT NULL AS configuration_present',
      ['syrve_table_sync_states', 'syrve_order_versions', 'syrve_table_links', 'syrve_integrations'].map(qualified));
      // No reads of absent feature columns in the legacy production schema.
      const snapshot = storage.configuration_present ? await this.settings.read(manager, true) : null;
      const link = snapshot?.prepared ? snapshot.links.find((value) => value.moloTableId === moloTableId.toLowerCase()) : null;
      if (link && (!snapshot?.entity?.configurationRevision || link.integrationId !== snapshot.entity.id
        || (snapshot.entity.organizationId && link.organizationId !== snapshot.entity.organizationId))) throw staleSyrveSettings();
      const result = await write(manager);
      if (link && storage.durable) {
        await this.states.recordStaffActionInTransaction(manager, snapshot!, moloTableId, action);
      } else if (link) {
        // A temporary missing ledger must not resurrect an old capture after
        // schema recovery. Preserve versions, suppress only existing IDs and
        // rotate the configuration fence, without fabricating durable history.
        await manager.query('UPDATE ' + qualified('syrve_integrations') + ' SET "configuration_revision"=$2 WHERE "id"=$1',
          [snapshot!.entity!.id, randomUUID()]);
        if (action === 'manual_free') await manager.query('UPDATE ' + qualified('syrve_table_links')
          + ' SET "manually_freed_syrve_order_ids"="active_syrve_order_ids" WHERE "id"=$1', [link.id]);
      }
      return result;
    });
  }
}
