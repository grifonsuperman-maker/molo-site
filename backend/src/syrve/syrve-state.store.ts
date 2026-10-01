import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';

import { SyrveSettingsSnapshot, SyrveSettingsStore, settingsVersion, staleSyrveSettings } from './syrve-settings.store';
import { createSyrveTableSyncState, getSyrveOrderIdsToObserve, reduceSyrveOrderState, reduceSyrveStaffAction,
  SyrveOrderObservationBatch, SyrveStateScope, SyrveTableSyncState, SyrveTransition } from './syrve-state-reducer';

export type SyrveStateCapture = { linkId: string; state: SyrveTableSyncState; orderIds: string[][] };

// Internal preparation only. Deliberately not a provider/export in any module,
// not a controller API, and not called by staff actions or an observer/worker.
export class SyrveStateStore {
  constructor(private readonly dataSource: DataSource, private readonly settings: SyrveSettingsStore) {}

  private table(name: string) {
    const options = this.dataSource.options;
    const schema = options.type === 'postgres' ? options.schema || 'public' : 'public';
    return '"' + schema.replace(/"/g, '""') + '"."' + name + '"';
  }

  private requireConnection(snapshot: SyrveSettingsSnapshot) {
    if (!snapshot.prepared || !snapshot.entity?.configurationRevision || !snapshot.entity.organizationId
      || snapshot.entity.status !== 'connected') throw staleSyrveSettings();
    return snapshot.entity;
  }

  private async lockedState(manager: EntityManager, snapshot: SyrveSettingsSnapshot, moloTableId: string) {
    const entity = this.requireConnection(snapshot);
    const [schema] = await manager.query('SELECT to_regclass($1) IS NOT NULL AND to_regclass($2) IS NOT NULL AS prepared',
      [this.table('syrve_table_sync_states'), this.table('syrve_order_versions')]);
    if (!schema.prepared) throw new ServiceUnavailableException('Постійне зберігання стану Syrve ще не підготовлено.');
    // Same order as the future staff hook: settings -> physical table -> link
    // -> snapshot. All competing instances use the settings transaction fence.
    const physical = await manager.query('SELECT "id" FROM ' + this.table('tables') + ' WHERE "id"=$1 FOR UPDATE', [moloTableId]);
    if (physical.length !== 1) throw staleSyrveSettings();
    const [link] = await manager.query('SELECT * FROM ' + this.table('syrve_table_links') + ' WHERE "molo_table_id"=$1 FOR UPDATE', [moloTableId]);
    if (!link || link.integration_id !== entity.id || link.organization_id !== entity.organizationId) throw staleSyrveSettings();
    const scope: SyrveStateScope = { integrationId: entity.id, configurationRevision: entity.configurationRevision,
      organizationId: link.organization_id, moloTableId: link.molo_table_id, syrveTableId: link.syrve_table_id };
    let [saved] = await manager.query('SELECT * FROM ' + this.table('syrve_table_sync_states') + ' WHERE "link_id"=$1 FOR UPDATE', [link.id]);
    if (!saved) {
      // Existing occupancy without versions cannot be safely invented/backfilled.
      if (link.last_syrve_state !== 'unknown' || link.active_syrve_order_ids.length || link.manually_freed_syrve_order_ids.length) {
        throw new ConflictException('Збережені замовлення Syrve потребують перевірки версій перед синхронізацією.');
      }
      const state = createSyrveTableSyncState(scope, randomUUID());
      await manager.query('INSERT INTO ' + this.table('syrve_table_sync_states')
        + ' ("link_id", "integration_id", "configuration_revision", "organization_id", "molo_table_id", "syrve_table_id", "local_revision")'
        + ' VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [link.id, scope.integrationId, scope.configurationRevision, scope.organizationId, scope.moloTableId, scope.syrveTableId, state.localRevision]);
      saved = { ...link, configuration_revision: scope.configurationRevision, local_revision: state.localRevision };
    }
    if (saved.integration_id !== scope.integrationId || saved.organization_id !== scope.organizationId
      || saved.molo_table_id !== scope.moloTableId || saved.syrve_table_id !== scope.syrveTableId) throw staleSyrveSettings();
    const versions = await manager.query('SELECT "order_id", "timestamp", "state", "fingerprint" FROM '
      + this.table('syrve_order_versions') + ' WHERE "link_id"=$1 ORDER BY "order_id"', [link.id]);
    const state: SyrveTableSyncState = { scope: { ...scope, configurationRevision: saved.configuration_revision },
      localRevision: saved.local_revision, lastSyrveState: link.last_syrve_state,
      activeSyrveOrderIds: link.active_syrve_order_ids, manuallyFreedSyrveOrderIds: link.manually_freed_syrve_order_ids,
      orderVersions: versions.map((row) => ({ id: row.order_id, timestamp: Number(row.timestamp), state: row.state, fingerprint: row.fingerprint })) };
    // Validate the entire restored ledger before either adoption or any write.
    getSyrveOrderIdsToObserve(state);
    if (saved.configuration_revision !== scope.configurationRevision) {
      // Recheck/reconnect must fence old requests without losing suppressed IDs
      // or tombstones for the same persisted UUID binding.
      state.scope = scope;
      state.localRevision = randomUUID();
      await this.persist(manager, link.id, state);
    }
    return { linkId: link.id as string, state };
  }

  private async persist(manager: EntityManager, linkId: string, state: SyrveTableSyncState) {
    getSyrveOrderIdsToObserve(state);
    // No trimming, deletion or response-sized cap on the cumulative ledger.
    await manager.query('INSERT INTO ' + this.table('syrve_order_versions')
      + ' ("link_id","order_id","timestamp","state","fingerprint") SELECT $1, v.id, v.timestamp, v.state, v.fingerprint'
      + ' FROM jsonb_to_recordset($2::jsonb) AS v(id uuid, timestamp bigint, state text, fingerprint text)'
      + ' ON CONFLICT ("link_id","order_id") DO UPDATE SET "timestamp"=EXCLUDED."timestamp", "state"=EXCLUDED."state", "fingerprint"=EXCLUDED."fingerprint"',
    [linkId, JSON.stringify(state.orderVersions)]);
    await manager.query('UPDATE ' + this.table('syrve_table_links')
      + ' SET "last_syrve_state"=$2,"active_syrve_order_ids"=$3,"manually_freed_syrve_order_ids"=$4 WHERE "id"=$1',
    [linkId, state.lastSyrveState, state.activeSyrveOrderIds, state.manuallyFreedSyrveOrderIds]);
    await manager.query('UPDATE ' + this.table('syrve_table_sync_states')
      + ' SET "configuration_revision"=$2,"local_revision"=$3 WHERE "link_id"=$1',
    [linkId, state.scope.configurationRevision, state.localRevision]);
  }

  async capture(moloTableId: string): Promise<SyrveStateCapture> {
    const snapshot = await this.settings.read();
    this.requireConnection(snapshot);
    return this.settings.transaction(settingsVersion(snapshot), async (manager, current) => {
      const value = await this.lockedState(manager, current, moloTableId);
      return { ...value, orderIds: getSyrveOrderIdsToObserve(value.state) };
    });
  }

  async applyObservation(captured: SyrveStateCapture, batches: SyrveOrderObservationBatch[]): Promise<SyrveTransition> {
    const expected = captured.state.scope;
    return this.settings.transaction({ id: expected.integrationId, revision: expected.configurationRevision }, async (manager, current) => {
      const value = await this.lockedState(manager, current, expected.moloTableId);
      if (value.linkId !== captured.linkId) throw staleSyrveSettings();
      // Only the freshly locked state is authoritative. A modified/replayed
      // capture cannot supply membership, watermarks, next revision or POS proof.
      const result = reduceSyrveOrderState(value.state, { expectedScope: expected, expectedRevision: captured.state.localRevision,
        currentScope: value.state.scope, nextRevision: randomUUID(), probe: batches, visibilityVerified: false });
      if (result.changed) await this.persist(manager, value.linkId, result.state);
      return result;
    });
  }

  async recordStaffAction(moloTableId: string, action: 'manual_free' | 'status_changed'): Promise<SyrveTransition> {
    const snapshot = await this.settings.read();
    this.requireConnection(snapshot);
    return this.settings.transaction(settingsVersion(snapshot), async (manager, current) => {
      const value = await this.lockedState(manager, current, moloTableId);
      const result = reduceSyrveStaffAction(value.state, { expectedScope: value.state.scope,
        expectedRevision: value.state.localRevision, currentScope: value.state.scope, nextRevision: randomUUID(), action });
      await this.persist(manager, value.linkId, result.state);
      return result;
    });
  }
}
