import { randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { SyrveSettingsStore, settingsVersion, staleSyrveSettings } from './syrve-settings.store';
import { syrveCaptureContext, SyrveStateCapture, SyrveStateStore } from './syrve-state.store';
import { SyrveOrderObservationBatch } from './syrve-state-reducer';
import { SYRVE_WORKER_MAX_TABLES, SyrveWorkerError, SyrveWorkerLease, workerBackoff } from './syrve-worker.model';
import { SyrveActivationStore } from './syrve-activation.store';
import { ConflictException } from '@nestjs/common';
import { isVerifiedLoadedProbe, SyrveClientException } from './syrve-client';

// Internal prepared adapter. Short transactions only; no lease transaction is
// held over HTTP. PostgreSQL time and the random lease token fence every write.
export class SyrveWorkerStore {
  private readonly states: SyrveStateStore;
  private readonly activation: SyrveActivationStore;
  constructor(private readonly source: DataSource, private readonly settings: SyrveSettingsStore) {
    this.states = new SyrveStateStore(source, settings);
    this.activation = new SyrveActivationStore(source, settings);
  }
  private table(name: string) {
    const options = this.source.options;
    const schema = options.type === 'postgres' ? options.schema || 'public' : 'public';
    return '"' + schema.replace(/"/g, '""') + '"."' + name + '"';
  }

  async claim(): Promise<{ status: 'disabled' | 'idle' | 'busy' | 'backoff' } | { status: 'claimed'; lease: SyrveWorkerLease }> {
    return this.settings.localTransaction(async (manager) => {
      const snapshot = await this.settings.read(manager, true), entity = snapshot.entity;
      if (!(await this.activation.read(snapshot, manager)).enabled) return { status: 'disabled' };
      if (!snapshot.prepared || !entity?.configurationRevision || !entity.organizationId || entity.status !== 'connected'
        || !entity.apiLoginEncrypted || !entity.apiLoginIv || !entity.apiLoginAuthTag || !snapshot.links.length) return { status: 'idle' };
      const links = [...snapshot.links].sort((a, b) => a.id.localeCompare(b.id));
      if (links.some((link) => link.integrationId !== entity.id || link.organizationId !== entity.organizationId)) throw staleSyrveSettings();
      const [schema] = await manager.query('SELECT to_regclass($1) IS NOT NULL AND to_regclass($2) IS NOT NULL'
        + ' AND to_regclass($3) IS NOT NULL AS prepared',
      [this.table('syrve_worker_state'), this.table('syrve_table_sync_states'), this.table('syrve_order_versions')]);
      if (!schema.prepared) return { status: 'idle' };
      const job = this.table('syrve_worker_state');
      await manager.query('INSERT INTO ' + job + ' (integration_id,configuration_revision) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [entity.id, entity.configurationRevision]);
      const [saved] = await manager.query('SELECT *, lease_until > clock_timestamp() AS busy,'
        + ' next_attempt_at > clock_timestamp() AS waiting FROM ' + job + ' WHERE integration_id=$1 FOR UPDATE', [entity.id]);
      // Reconfiguration never starts a second runner while the old lease lives.
      if (saved.busy) return { status: 'busy' };
      if (saved.configuration_revision === entity.configurationRevision && saved.waiting) return { status: 'backoff' };
      const same = saved.configuration_revision === entity.configurationRevision;
      const index = same ? links.findIndex((link) => link.id === saved.cursor_link_id) : -1;
      const rotated = [...links.slice(index + 1), ...links.slice(0, index + 1)].slice(0, SYRVE_WORKER_MAX_TABLES);
      const leaseId = randomUUID();
      await manager.query('UPDATE ' + job + ' SET configuration_revision=$2,lease_id=$3,'
        + " lease_until=clock_timestamp()+interval '90 seconds',last_attempt_at=clock_timestamp(),"
        + ' failure_count=CASE WHEN configuration_revision=$2 THEN failure_count ELSE 0 END,'
        + ' last_success_at=CASE WHEN configuration_revision=$2 THEN last_success_at ELSE NULL END,'
        + ' last_error_code=CASE WHEN configuration_revision=$2 THEN last_error_code ELSE NULL END,'
        + ' cursor_link_id=CASE WHEN configuration_revision=$2 THEN cursor_link_id ELSE NULL END WHERE integration_id=$1',
      [entity.id, entity.configurationRevision, leaseId]);
      return { status: 'claimed', lease: { id: leaseId, version: settingsVersion(snapshot), links: rotated } };
    });
  }

  capture(tableId: string) { return this.states.capture(tableId); }

  async captureBatch(lease: SyrveWorkerLease) {
    return lease.links.length === 1 ? [await this.capture(lease.links[0].moloTableId)]
      : this.states.captureBatch(lease.links.map(link => link.moloTableId), lease.version);
  }

  guard(lease: SyrveWorkerLease, captured: SyrveStateCapture) {
    return this.settings.transaction(lease.version, async (manager, current) => {
      await this.lockedLease(manager, lease);
      const expected = captured.state.scope;
      if (current.entity?.organizationId !== expected.organizationId || !current.links.some(link => link.id === captured.linkId
        && link.integrationId === expected.integrationId && link.organizationId === expected.organizationId
        && link.moloTableId === expected.moloTableId && link.syrveTableId === expected.syrveTableId)) throw staleSyrveSettings();
      const active = await this.activation.read(current, manager);
      const [state] = await manager.query('SELECT local_revision FROM ' + this.table('syrve_table_sync_states') + ' WHERE link_id=$1', [captured.linkId]);
      if (state?.local_revision !== captured.state.localRevision) throw new ConflictException({ statusCode: 409, code: 'SYRVE_LOCAL_STATE_CHANGED',
        message: 'Стан столу змінився після ручної дії. Запізнілу відповідь каси відхилено.' });
      if (!active.enabled || !active.plan || current.entity?.status !== 'connected'
        || expected.integrationId !== lease.version.id || expected.configurationRevision !== lease.version.revision
        || !lease.links.some(link => link.id === captured.linkId && link.moloTableId === expected.moloTableId && link.syrveTableId === expected.syrveTableId)) throw staleSyrveSettings();
      const group = active.plan.groups.find(group => group.tableIds.includes(expected.syrveTableId));
      if (!group) throw staleSyrveSettings();
      return { organizationId: active.plan.organizationId, groups: [{ ...group, tableIds: [expected.syrveTableId] }] };
    });
  }

  guardBatch(lease: SyrveWorkerLease, captures: SyrveStateCapture[]) {
    return this.settings.transaction(lease.version, async (manager, current) => {
      await this.lockedLease(manager, lease);
      const active = await this.activation.read(current, manager);
      if (!active.enabled || !active.plan || current.entity?.status !== 'connected' || captures.length !== lease.links.length
        || new Set(captures.map(capture => capture.linkId)).size !== captures.length) throw staleSyrveSettings();
      for (const captured of captures) {
        const expected = captured.state.scope;
        if (expected.integrationId !== lease.version.id || expected.configurationRevision !== lease.version.revision
          || current.entity.organizationId !== expected.organizationId
          || !current.links.some(link => link.id === captured.linkId && link.moloTableId === expected.moloTableId
            && link.syrveTableId === expected.syrveTableId && link.organizationId === expected.organizationId)
          || !lease.links.some(link => link.id === captured.linkId && link.moloTableId === expected.moloTableId
            && link.syrveTableId === expected.syrveTableId)) throw staleSyrveSettings();
        // Local/physical revisions are checked atomically by apply for this
        // table. A staff action must not revoke the whole shared HTTP batch.
      }
      const ids = new Set(captures.map(capture => capture.state.scope.syrveTableId));
      const groups = active.plan.groups.map(group => ({ ...group, tableIds: group.tableIds.filter(id => ids.has(id)) }))
        .filter(group => group.tableIds.length);
      if (groups.reduce((count, group) => count + group.tableIds.length, 0) !== ids.size) throw staleSyrveSettings();
      return { organizationId: active.plan.organizationId, groups };
    });
  }

  heartbeat(lease: SyrveWorkerLease) {
    return this.settings.transaction(lease.version, async (manager, current) => {
      await this.lockedLease(manager, lease);
      if (!(await this.activation.read(current, manager)).enabled || current.entity?.status !== 'connected') throw staleSyrveSettings();
      await manager.query('UPDATE ' + this.table('syrve_worker_state') + " SET lease_until=clock_timestamp()+interval '90 seconds'"
        + ' WHERE integration_id=$1 AND lease_id=$2', [lease.version.id, lease.id]);
    });
  }

  private async lockedLease(manager: EntityManager, lease: SyrveWorkerLease) {
    const [row] = await manager.query('SELECT *,lease_until > clock_timestamp() AS live FROM ' + this.table('syrve_worker_state')
      + ' WHERE integration_id=$1 FOR UPDATE', [lease.version.id]);
    if (!row || row.lease_id !== lease.id || row.configuration_revision !== lease.version.revision || !row.live) throw staleSyrveSettings();
    return row;
  }

  private async record(manager: EntityManager, lease: SyrveWorkerLease, linkId: string, failures: number, code: SyrveWorkerError | null) {
    const delay = code ? workerBackoff(failures, code) : 15_000;
    await manager.query('UPDATE ' + this.table('syrve_worker_state') + ' SET cursor_link_id=$3,failure_count=$4,last_error_code=$5::varchar,'
      + " next_attempt_at=clock_timestamp()+($6::int*interval '1 millisecond'),"
      + ' last_success_at=CASE WHEN $5::varchar IS NULL THEN clock_timestamp() ELSE last_success_at END'
      + ' WHERE integration_id=$1 AND lease_id=$2', [lease.version.id, lease.id, linkId, failures, code, delay]);
  }

  apply(lease: SyrveWorkerLease, captured: SyrveStateCapture, batches: SyrveOrderObservationBatch[]) {
    return this.settings.transaction(lease.version, async (manager, current) => {
      const row = await this.lockedLease(manager, lease);
      if (!(await this.activation.read(current, manager)).enabled) throw staleSyrveSettings();
      if (current.entity?.status !== 'connected' || captured.state.scope.integrationId !== lease.version.id
        || captured.state.scope.configurationRevision !== lease.version.revision
        || !lease.links.some((link) => link.id === captured.linkId && link.moloTableId === captured.state.scope.moloTableId
          && link.syrveTableId === captured.state.scope.syrveTableId)) throw staleSyrveSettings();
      const result = await this.states.applyWorkerObservationInTransaction(manager, current, captured, batches, lease.id);
      // A large restored ledger may take time to write. Expiry before the final
      // bookkeeping write rolls the entire observation transaction back.
      await this.lockedLease(manager, lease);
      if (batches.some(batch => !isVerifiedLoadedProbe(batch.probe, syrveCaptureContext(lease.id, captured),
        captured.state.scope.organizationId, captured.state.scope.syrveTableId))) throw new SyrveClientException('SYRVE_TIMEOUT');
      const stale = result.diagnostics.includes('local_revision_changed') || result.diagnostics.includes('scope_changed');
      const unknown = result.diagnostics.some((code) => ['observation_unknown', 'unknown_orders', 'conflicting_order_versions', 'visibility_not_verified'].includes(code));
      const code: SyrveWorkerError | null = stale ? 'SYRVE_LOCAL_STATE_CHANGED' : unknown ? 'SYRVE_OBSERVATION_UNKNOWN' : null;
      await this.record(manager, lease, captured.linkId, code ? Math.min(20, row.failure_count + 1) : 0, code);
      return { result, code };
    });
  }

  failure(lease: SyrveWorkerLease, linkId: string, code: SyrveWorkerError) {
    return this.settings.transaction(lease.version, async (manager, current) => {
      if (current.entity?.status !== 'connected') throw staleSyrveSettings();
      if (!(await this.activation.read(current, manager)).enabled) throw staleSyrveSettings();
      const row = await this.lockedLease(manager, lease);
      await this.record(manager, lease, linkId, Math.min(20, row.failure_count + 1), code);
    });
  }

  partialFailure(lease: SyrveWorkerLease, linkId: string, code: SyrveWorkerError) {
    return this.settings.transaction(lease.version, async (manager, current) => {
      if (current.entity?.status !== 'connected') throw staleSyrveSettings();
      if (!(await this.activation.read(current, manager)).enabled) throw staleSyrveSettings();
      await this.lockedLease(manager, lease);
      // A partial register outage must remain visible without escalating the
      // integration-wide backoff and suppressing healthy register groups.
      await this.record(manager, lease, linkId, 0, code);
    });
  }

  release(lease: SyrveWorkerLease) {
    // Token compare-and-set cannot clear a lease reacquired after a crash or
    // reconfiguration. Releasing stale work records no error for the new scope.
    return this.settings.localTransaction((manager) => manager.query('UPDATE ' + this.table('syrve_worker_state')
      + ' SET lease_id=NULL,lease_until=NULL WHERE integration_id=$1 AND lease_id=$2', [lease.version.id, lease.id]));
  }
}
