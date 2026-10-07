import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';

import { SyrveSettingsSnapshot, SyrveSettingsStore, SyrveSettingsVersion, settingsVersion, staleSyrveSettings } from './syrve-settings.store';
import { createSyrveTableSyncState, getSyrveOrderIdsToObserve, reduceSyrveOrderState, reduceSyrveStaffAction,
  syrveTableStatusEvent, SyrveOrderObservationBatch, SyrveStateScope, SyrveTableSyncState, SyrveTransition } from './syrve-state-reducer';
import { isVerifiedLoadedProbe } from './syrve-client';

export type SyrveStateCapture = { linkId: string; state: SyrveTableSyncState; orderIds: string[][]; physicalVersion: string };
export const syrveCaptureContext = (leaseId: string, captured: SyrveStateCapture) =>
  leaseId + ':' + captured.state.localRevision + ':' + captured.physicalVersion;

// Internal adapter, not a provider/export or controller API. Only the staff
// coordinator and the consented worker use it at runtime. Ordinary observations
// cannot supply a POS visibility receipt.
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

  private async lockedState(manager: EntityManager, snapshot: SyrveSettingsSnapshot, moloTableId: string, staff = false) {
    const entity = staff ? snapshot.entity : this.requireConnection(snapshot);
    if (!snapshot.prepared || !entity?.configurationRevision) throw staleSyrveSettings();
    const [schema] = await manager.query('SELECT to_regclass($1) IS NOT NULL AND to_regclass($2) IS NOT NULL AS prepared',
      [this.table('syrve_table_sync_states'), this.table('syrve_order_versions')]);
    if (!schema.prepared) throw new ServiceUnavailableException('Постійне зберігання стану Syrve ще не підготовлено.');
    // Same order as the staff hook: settings -> physical table -> link
    // -> snapshot. All competing instances use the settings transaction fence.
    const physical = await manager.query('SELECT "id","status","updated_at"::text AS physical_updated_at FROM '
      + this.table('tables') + ' WHERE "id"=$1 FOR UPDATE', [moloTableId]);
    if (physical.length !== 1) throw staleSyrveSettings();
    // PostgreSQL text retains microseconds; Date would truncate the timestamp.
    // This also fences direct booking/transfer writers without changing them.
    const physicalVersion = createHash('sha256').update(JSON.stringify([physical[0].status, physical[0].physical_updated_at])).digest('hex');
    const [link] = await manager.query('SELECT * FROM ' + this.table('syrve_table_links') + ' WHERE "molo_table_id"=$1 FOR UPDATE', [moloTableId]);
    if (!link || link.integration_id !== entity.id
      || ((!staff || entity.organizationId) && link.organization_id !== entity.organizationId)) throw staleSyrveSettings();
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
    return { linkId: link.id as string, state, physicalVersion };
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

  captureBatch(tableIds: string[], expected: SyrveSettingsVersion): Promise<SyrveStateCapture[]> {
    return this.settings.transaction(expected, async (manager, current) => {
      const entity = this.requireConnection(current);
      if (!tableIds.length || new Set(tableIds).size !== tableIds.length) throw staleSyrveSettings();
      const [schema] = await manager.query('SELECT to_regclass($1) IS NOT NULL AND to_regclass($2) IS NOT NULL AS prepared',
        [this.table('syrve_table_sync_states'), this.table('syrve_order_versions')]);
      if (!schema.prepared) throw new ServiceUnavailableException('Постійне зберігання стану Syrve ще не підготовлено.');
      // Preserve settings -> physical -> links -> states lock order, with a
      // bounded number of round trips rather than a transaction per table.
      const physical = await manager.query('SELECT id,status,updated_at::text AS physical_updated_at FROM '
        + this.table('tables') + ' WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE', [tableIds]);
      const links = await manager.query('SELECT * FROM ' + this.table('syrve_table_links')
        + ' WHERE molo_table_id=ANY($1::uuid[]) ORDER BY id FOR UPDATE', [tableIds]);
      if (physical.length !== tableIds.length || links.length !== tableIds.length) throw staleSyrveSettings();
      const linkIds = links.map(link => link.id);
      const states = await manager.query('SELECT * FROM ' + this.table('syrve_table_sync_states')
        + ' WHERE link_id=ANY($1::uuid[]) ORDER BY link_id FOR UPDATE', [linkIds]);
      const versions = await manager.query('SELECT link_id,order_id,timestamp,state,fingerprint FROM '
        + this.table('syrve_order_versions') + ' WHERE link_id=ANY($1::uuid[]) ORDER BY link_id,order_id', [linkIds]);
      const updates: Record<string, unknown>[] = [];
      const captures = tableIds.map(moloTableId => {
        const link = links.find(link => link.molo_table_id === moloTableId), saved = states.find(state => state.link_id === link?.id);
        if (!link || link.integration_id !== entity.id || link.organization_id !== entity.organizationId
          || (saved && (saved.integration_id !== link.integration_id || saved.organization_id !== link.organization_id
            || saved.molo_table_id !== link.molo_table_id || saved.syrve_table_id !== link.syrve_table_id))) throw staleSyrveSettings();
        if (!saved && (link.last_syrve_state !== 'unknown' || link.active_syrve_order_ids.length || link.manually_freed_syrve_order_ids.length)) {
          throw new ConflictException('Збережені замовлення Syrve потребують перевірки версій перед синхронізацією.');
        }
        const scope: SyrveStateScope = { integrationId: entity.id, configurationRevision: entity.configurationRevision,
          organizationId: link.organization_id, moloTableId, syrveTableId: link.syrve_table_id };
        const state: SyrveTableSyncState = { scope, localRevision: saved?.local_revision || randomUUID(),
          lastSyrveState: link.last_syrve_state, activeSyrveOrderIds: link.active_syrve_order_ids,
          manuallyFreedSyrveOrderIds: link.manually_freed_syrve_order_ids,
          orderVersions: versions.filter(version => version.link_id === link.id).map(version => ({ id: version.order_id,
            timestamp: Number(version.timestamp), state: version.state, fingerprint: version.fingerprint })) };
        const orderIds = getSyrveOrderIdsToObserve(state); // Validate the full ledger before any adoption.
        if (!saved || saved.configuration_revision !== scope.configurationRevision) {
          state.localRevision = randomUUID();
          updates.push({ link_id: link.id, integration_id: entity.id, configuration_revision: scope.configurationRevision,
            organization_id: scope.organizationId, molo_table_id: moloTableId, syrve_table_id: scope.syrveTableId, local_revision: state.localRevision });
        }
        const table = physical.find(table => table.id === moloTableId)!;
        const physicalVersion = createHash('sha256').update(JSON.stringify([table.status, table.physical_updated_at])).digest('hex');
        return { linkId: link.id as string, state, orderIds, physicalVersion };
      });
      if (updates.length) await manager.query('INSERT INTO ' + this.table('syrve_table_sync_states')
        + ' (link_id,integration_id,configuration_revision,organization_id,molo_table_id,syrve_table_id,local_revision)'
        + ' SELECT link_id,integration_id,configuration_revision,organization_id,molo_table_id,syrve_table_id,local_revision'
        + ' FROM jsonb_to_recordset($1::jsonb) AS v(link_id uuid,integration_id uuid,configuration_revision uuid,organization_id uuid,'
        + ' molo_table_id uuid,syrve_table_id uuid,local_revision uuid) ON CONFLICT(link_id) DO UPDATE'
        + ' SET configuration_revision=EXCLUDED.configuration_revision,local_revision=EXCLUDED.local_revision', [JSON.stringify(updates)]);
      return captures;
    });
  }

  async applyObservation(captured: SyrveStateCapture, batches: SyrveOrderObservationBatch[]): Promise<SyrveTransition> {
    const expected = captured.state.scope;
    return this.settings.transaction({ id: expected.integrationId, revision: expected.configurationRevision }, (manager, current) =>
      this.applyObservationInTransaction(manager, current, captured, batches));
  }

  async applyObservationInTransaction(manager: EntityManager, current: SyrveSettingsSnapshot,
    captured: SyrveStateCapture, batches: SyrveOrderObservationBatch[]): Promise<SyrveTransition> {
    return this.applyLockedObservation(manager, current, captured, batches);
  }

  async applyWorkerObservationInTransaction(manager: EntityManager, current: SyrveSettingsSnapshot,
    captured: SyrveStateCapture, batches: SyrveOrderObservationBatch[], leaseId: string): Promise<SyrveTransition> {
    return this.applyLockedObservation(manager, current, captured, batches, syrveCaptureContext(leaseId, captured));
  }

  private async applyLockedObservation(manager: EntityManager, current: SyrveSettingsSnapshot,
    captured: SyrveStateCapture, batches: SyrveOrderObservationBatch[], context?: string, strictActivation = false): Promise<SyrveTransition> {
    if (!manager.queryRunner?.isTransactionActive) throw new ServiceUnavailableException('Стан Syrve потребує активної транзакції.');
    const expected = captured.state.scope;
    const value = await this.lockedState(manager, current, expected.moloTableId);
    if (value.linkId !== captured.linkId) throw staleSyrveSettings();
    if (value.physicalVersion !== captured.physicalVersion) {
      if (strictActivation) throw staleSyrveSettings();
      return { state: value.state, changed: false, diagnostics: ['local_revision_changed'] };
    }
    // Only the freshly locked state is authoritative. A modified/replayed
    // capture cannot supply membership, watermarks, next revision or POS proof.
    const result = reduceSyrveOrderState(value.state, { expectedScope: expected, expectedRevision: captured.state.localRevision,
      currentScope: value.state.scope, nextRevision: randomUUID(), probe: batches,
      visibilityVerified: Boolean(context && batches.length && batches.every(batch => isVerifiedLoadedProbe(batch.probe, context,
        expected.organizationId, expected.syrveTableId))) });
    if (strictActivation && result.diagnostics.length) throw new ConflictException('Початкова звірка отримала неповні або застарілі дані. Повторіть перевірку.');
    const status = syrveTableStatusEvent(value.state, result);
    if (result.changed) {
      await this.persist(manager, value.linkId, result.state);
      if (status) {
        // The physical UUID is already locked. Do not inspect manual status,
        // bookings or banquet membership, and never create/rename a table.
        await manager.query('UPDATE ' + this.table('tables')
          + ' SET "status"=$2,"updated_at"=clock_timestamp() WHERE "id"=$1', [expected.moloTableId, status]);
      }
    }
    return result;
  }

  async recordStaffAction(moloTableId: string, action: 'manual_free' | 'status_changed'): Promise<SyrveTransition> {
    const snapshot = await this.settings.read();
    this.requireConnection(snapshot);
    return this.settings.transaction(settingsVersion(snapshot), (manager, current) =>
      this.recordStaffActionInTransaction(manager, current, moloTableId, action));
  }

  // Activation uses the same once-per-event policy as worker reads. Its stricter
  // failure policy rolls back all tables and consent on any uncertain result.
  async applyActivationObservationInTransaction(manager: EntityManager, current: SyrveSettingsSnapshot,
    captured: SyrveStateCapture, batches: SyrveOrderObservationBatch[], leaseId: string): Promise<SyrveTransition> {
    return this.applyLockedObservation(manager, current, captured, batches, syrveCaptureContext(leaseId, captured), true);
  }

  // The coordinator already holds the settings fence. Never start a second
  // transaction here: the physical action and this revision must commit together.
  async recordStaffActionInTransaction(manager: EntityManager, snapshot: SyrveSettingsSnapshot,
    moloTableId: string, action: 'manual_free' | 'status_changed'): Promise<SyrveTransition> {
    if (!manager.queryRunner?.isTransactionActive) {
      throw new ServiceUnavailableException('Ручна дія та стан Syrve мають зберігатися в одній транзакції.');
    }
    const value = await this.lockedState(manager, snapshot, moloTableId, true);
    const result = reduceSyrveStaffAction(value.state, { expectedScope: value.state.scope,
      expectedRevision: value.state.localRevision, currentScope: value.state.scope, nextRevision: randomUUID(), action });
    await this.persist(manager, value.linkId, result.state);
    return result;
  }
}
