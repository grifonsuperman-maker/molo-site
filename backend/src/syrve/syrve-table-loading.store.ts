import { BadRequestException, ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { TableEntity } from '../tables/entities/table.entity';
import { savedSyrveFingerprint } from './syrve-saved-scope';
import { settingsVersion, staleSyrveSettings, SyrveSettingsStore, type SyrveSettingsSnapshot } from './syrve-settings.store';
import { LOADING_MAX_TABLES } from './syrve-table-loading';
import { SyrveActivationStore } from './syrve-activation.store';

export type TableLoadingCapture = { snapshot: SyrveSettingsSnapshot; tables: TableEntity[]; fingerprint: string };
export type TableLoadingLease = TableLoadingCapture & { leaseId: string };

@Injectable()
export class SyrveTableLoadingStore {
  constructor(private readonly source: DataSource, private readonly settings: SyrveSettingsStore) {}
  private table(name: string) {
    const options = this.source.options;
    const schema = options.type === 'postgres' ? options.schema || 'public' : 'public';
    return '"' + schema.replace(/"/g, '""') + '"."' + name + '"';
  }
  private rows(manager: EntityManager) {
    return manager.getRepository(TableEntity).find({ select: { id: true, tableNumber: true, status: true, updatedAt: true } });
  }
  private requireScope(snapshot: SyrveSettingsSnapshot, tables: TableEntity[], revision: string) {
    const entity = snapshot.entity;
    if (!snapshot.prepared) throw new ServiceUnavailableException('Серверна підготовка інтеграції ще не завершена.');
    if (!entity || entity.configurationRevision !== revision) throw staleSyrveSettings();
    if (entity.status !== 'connected' || !entity.organizationId || !entity.apiLoginEncrypted || !entity.apiLoginIv || !entity.apiLoginAuthTag
      || !snapshot.links.length) throw new BadRequestException('Спочатку збережіть підключення та підтвердьте зв’язки столів Syrve.');
    if (snapshot.links.length > LOADING_MAX_TABLES) throw new BadRequestException('Кількість столів перевищує безпечний ліміт завантаження.');
    if (new Set(snapshot.links.map(link => link.moloTableId)).size !== snapshot.links.length
      || new Set(snapshot.links.map(link => link.syrveTableId)).size !== snapshot.links.length
      || snapshot.links.some(link => link.integrationId !== entity.id || link.organizationId !== entity.organizationId
        || !tables.some(table => table.id === link.moloTableId))) throw staleSyrveSettings();
  }
  async capture(revision: string): Promise<TableLoadingCapture> {
    const snapshot = await this.settings.read(), tables = await this.rows(this.source.manager);
    this.requireScope(snapshot, tables, revision);
    const [schema] = await this.source.manager.query('SELECT to_regclass($1) IS NOT NULL AS prepared', [this.table('syrve_worker_state')]);
    if (!schema.prepared) throw new ServiceUnavailableException('Безпечне завантаження стану столів ще не підготовлено на сервері.');
    const fingerprint = savedSyrveFingerprint(snapshot, tables);
    if (fingerprint !== savedSyrveFingerprint(await this.settings.read(), await this.rows(this.source.manager))) throw staleSyrveSettings();
    return { snapshot, tables, fingerprint };
  }
  async assertCurrent(captured: TableLoadingCapture) {
    const current = await this.capture(captured.snapshot.entity!.configurationRevision);
    if (current.fingerprint !== captured.fingerprint) throw staleSyrveSettings();
  }
  claim(captured: TableLoadingCapture): Promise<TableLoadingLease> {
    return this.settings.transaction(settingsVersion(captured.snapshot), async (manager, snapshot) => {
      await new SyrveActivationStore(this.source, this.settings).requireDisabled(snapshot, manager);
      // The common settings lock precedes physical rows, as in staff actions.
      // These short locks end before authentication or commands start.
      await manager.query('LOCK TABLE ' + this.table('tables') + ' IN SHARE ROW EXCLUSIVE MODE');
      const tables = await this.rows(manager);
      this.requireScope(snapshot, tables, captured.snapshot.entity!.configurationRevision);
      if (savedSyrveFingerprint(snapshot, tables) !== captured.fingerprint) throw staleSyrveSettings();
      const job = this.table('syrve_worker_state'), id = snapshot.entity!.id;
      await manager.query('INSERT INTO ' + job + ' (integration_id,configuration_revision) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [id, snapshot.entity!.configurationRevision]);
      const [row] = await manager.query('SELECT lease_until > clock_timestamp() AS busy FROM ' + job + ' WHERE integration_id=$1 FOR UPDATE', [id]);
      if (row?.busy) throw new ConflictException('Завантаження або перевірка вже триває. Дочекайтеся завершення перед новою спробою.');
      // Advancing the saved revision consumes every preview from the old
      // revision across instances/restarts, even if HTTP fails after commit.
      const entity = await this.settings.save(manager, { ...snapshot.entity });
      const next = { ...snapshot, entity }, leaseId = randomUUID();
      await manager.query('UPDATE ' + job + ' SET configuration_revision=$2,lease_id=$3,'
        + " lease_until=clock_timestamp()+interval '90 seconds',failure_count=0,next_attempt_at='-infinity',"
        + ' last_attempt_at=NULL,last_success_at=NULL,last_error_code=NULL,cursor_link_id=NULL WHERE integration_id=$1',
      [id, entity.configurationRevision, leaseId]);
      return { snapshot: next, tables, leaseId, fingerprint: savedSyrveFingerprint(next, tables) };
    });
  }
  async guard(lease: TableLoadingLease) {
    await this.assertCurrent(lease);
    const [row] = await this.source.manager.query('SELECT lease_id=$2 AND configuration_revision=$3'
      + ' AND lease_until > clock_timestamp() AS live FROM ' + this.table('syrve_worker_state') + ' WHERE integration_id=$1',
    [lease.snapshot.entity!.id, lease.leaseId, lease.snapshot.entity!.configurationRevision]);
    if (!row?.live) throw staleSyrveSettings();
  }
  release(lease: TableLoadingLease) {
    return this.settings.localTransaction(manager => manager.query('UPDATE ' + this.table('syrve_worker_state')
      + ' SET lease_id=NULL,lease_until=NULL WHERE integration_id=$1 AND lease_id=$2 AND configuration_revision=$3',
    [lease.snapshot.entity!.id, lease.leaseId, lease.snapshot.entity!.configurationRevision]));
  }
}
