import { ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { TableEntity } from '../tables/entities/table.entity';
import { activationBindings, activationPlan } from './syrve-activation';
import { savedSyrveFingerprint } from './syrve-saved-scope';
import { settingsVersion, staleSyrveSettings, SyrveSettingsStore, type SyrveSettingsSnapshot } from './syrve-settings.store';
import type { TableLoadingLease } from './syrve-table-loading.store';
import type { TableLoadingPlan } from './syrve-table-loading';
import { SyrveStateStore, type SyrveStateCapture } from './syrve-state.store';
import type { SyrveOrderObservationBatch } from './syrve-state-reducer';

export type SyrveInitialObservation = { capture: SyrveStateCapture; batches: SyrveOrderObservationBatch[] };

@Injectable()
export class SyrveActivationStore {
  constructor(private readonly source: DataSource, private readonly settings: SyrveSettingsStore) {}
  private table(name: string) {
    const schema = this.source.options.type === 'postgres' ? this.source.options.schema || 'public' : 'public';
    return '"' + schema.replace(/"/g, '""') + '"."' + name + '"';
  }
  async prepared(manager = this.source.manager): Promise<boolean> {
    const [row] = await manager.query('SELECT to_regclass($1) IS NOT NULL AS prepared', [this.table('syrve_sync_activation')]);
    return Boolean(row?.prepared);
  }
  async read(snapshot: SyrveSettingsSnapshot, manager = this.source.manager) {
    const disabled = { prepared: false, enabled: false, plan: null as TableLoadingPlan | null };
    if (!await this.prepared(manager)) return disabled;
    const entity = snapshot.entity;
    if (!snapshot.prepared || !entity?.configurationRevision || !entity.organizationId || !entity.apiLoginEncrypted
      || !entity.apiLoginIv || !entity.apiLoginAuthTag || !['connected','error'].includes(entity.status)) return { ...disabled, prepared: true };
    const [row] = await manager.query('SELECT * FROM ' + this.table('syrve_sync_activation') + ' WHERE integration_id=$1', [entity.id]);
    if (!row?.enabled || row.configuration_revision !== entity.configurationRevision) return { ...disabled, prepared: true };
    const tables = await manager.getRepository(TableEntity).find({ select: { id: true, tableNumber: true } });
    try {
      if (!row.consented_at || typeof row.actor_hash !== 'string' || !/^[0-9a-f]{64}$/.test(row.actor_hash)
        || activationBindings(snapshot, tables) !== row.bindings_fingerprint) throw staleSyrveSettings();
      return { prepared: true, enabled: true, plan: activationPlan(row.loading_plan, snapshot) };
    } catch {
      // Ordinary table edits can invalidate consent without rotating settings.
      // Keep public/manual reads and explicit recovery available; never reuse
      // the old scope for upstream commands or projected occupancy.
      return { ...disabled, prepared: true };
    }
  }
  async requireDisabled(snapshot: SyrveSettingsSnapshot, manager = this.source.manager) {
    if ((await this.read(snapshot, manager)).enabled) {
      throw new ConflictException('Спочатку вимкніть автоматичні статуси перед зміною або повторною перевіркою підключення.');
    }
  }
  captureTables(lease: TableLoadingLease) {
    return new SyrveStateStore(this.source, this.settings).captureBatch(
      lease.snapshot.links.map(link => link.moloTableId), settingsVersion(lease.snapshot));
  }
  enable(lease: TableLoadingLease, plan: TableLoadingPlan, actor: string, observations?: SyrveInitialObservation[]) {
    return this.settings.transaction(settingsVersion(lease.snapshot), async (manager, snapshot) => {
      if (!await this.prepared(manager)) throw new ServiceUnavailableException('Підготовку автоматичних статусів у базі ще не завершено.');
      await manager.query('LOCK TABLE ' + this.table('tables') + ' IN SHARE ROW EXCLUSIVE MODE');
      const tables = await manager.getRepository(TableEntity).find({ select: { id: true, tableNumber: true, status: true, updatedAt: true } });
      if (savedSyrveFingerprint(snapshot, tables) !== lease.fingerprint) throw staleSyrveSettings();
      const entity = snapshot.entity!;
      const [job] = await manager.query('SELECT lease_id=$2 AND configuration_revision=$3 AND lease_until > clock_timestamp() AS live'
        + ' FROM ' + this.table('syrve_worker_state') + ' WHERE integration_id=$1 FOR UPDATE', [entity.id, lease.leaseId, entity.configurationRevision]);
      if (!job?.live) throw staleSyrveSettings();
      const savedPlan = activationPlan(plan, snapshot), bindings = activationBindings(snapshot, tables);
      if (observations) {
        if (observations.length !== snapshot.links.length || new Set(observations.map(value => value.capture.linkId)).size !== observations.length
          || observations.some(value => !snapshot.links.some(link => link.id === value.capture.linkId))) throw staleSyrveSettings();
        const states = new SyrveStateStore(this.source, this.settings);
        for (const { capture, batches } of observations) {
          await states.applyActivationObservationInTransaction(manager, snapshot, capture, batches, lease.leaseId);
        }
        const [fresh] = await manager.query('SELECT lease_id=$2 AND configuration_revision=$3 AND lease_until > clock_timestamp() AS live'
          + ' FROM ' + this.table('syrve_worker_state') + ' WHERE integration_id=$1', [entity.id, lease.leaseId, entity.configurationRevision]);
        if (!fresh?.live) throw staleSyrveSettings();
      }
      await manager.query('INSERT INTO ' + this.table('syrve_sync_activation')
        + ' (integration_id,configuration_revision,enabled,bindings_fingerprint,loading_plan,actor_hash,consented_at)'
        + ' VALUES ($1,$2,true,$3,$4::jsonb,$5,clock_timestamp()) ON CONFLICT (integration_id) DO UPDATE'
        + ' SET configuration_revision=EXCLUDED.configuration_revision,enabled=true,bindings_fingerprint=EXCLUDED.bindings_fingerprint,'
        + ' loading_plan=EXCLUDED.loading_plan,actor_hash=EXCLUDED.actor_hash,consented_at=EXCLUDED.consented_at',
      [entity.id, entity.configurationRevision, bindings, JSON.stringify(savedPlan), actor]);
    });
  }
  async disable(revision: string) {
    const snapshot = await this.settings.read();
    if (snapshot.entity?.configurationRevision !== revision) throw staleSyrveSettings();
    return this.settings.transaction(settingsVersion(snapshot), async (manager, current) => {
      const entity = await this.settings.save(manager, { ...current.entity });
      if (await this.prepared(manager)) await manager.query('UPDATE ' + this.table('syrve_sync_activation')
        + ' SET enabled=false,configuration_revision=$2 WHERE integration_id=$1', [entity.id, entity.configurationRevision]);
      // Keep any old lease until release/expiry; no second runner can overlap an
      // unresolved command. The new configuration fence rejects every old write.
      return entity.configurationRevision;
    });
  }
}
