import { ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { randomUUID } from 'crypto';

import { SyrveIntegration } from './entities/syrve-integration.entity';
import { SyrveTableLink } from './entities/syrve-table-link.entity';

const LEGACY_COLUMNS = ['id', 'displayName', 'apiBaseUrl', 'apiLoginEncrypted', 'apiLoginIv',
  'apiLoginAuthTag', 'apiLoginMasked', 'organizationId', 'organizationName', 'status',
  'lastCheckedAt', 'connectedAt', 'lastError', 'createdAt', 'updatedAt'] as const;
export type SyrveSettingsSnapshot = { prepared: boolean; entity: SyrveIntegration | null; links: SyrveTableLink[] };
export type SyrveSettingsVersion = { id: string | null; revision: string | null };
export function settingsVersion(snapshot: SyrveSettingsSnapshot): SyrveSettingsVersion {
  return { id: snapshot.entity?.id || null, revision: snapshot.entity?.configurationRevision || null };
}
export function staleSyrveSettings() {
  return new ConflictException('Налаштування або столи змінилися. Повторіть перевірку перед підтвердженням.');
}

@Injectable()
export class SyrveSettingsStore {
  constructor(private readonly dataSource: DataSource) {}

  async read(manager = this.dataSource.manager, lock = false): Promise<SyrveSettingsSnapshot> {
    const options = this.dataSource.options;
    const schemaName = options?.type === 'postgres' ? options.schema || 'public' : 'public';
    const quotedSchema = '"' + schemaName.replace(/"/g, '""') + '"';
    const [schema] = await manager.query(`SELECT
      to_regclass($1) IS NOT NULL AS present,
      to_regclass($2) IS NOT NULL
      AND EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $3
        AND c.relname = 'UQ_syrve_integrations_singleton' AND i.indisunique AND i.indisvalid
        AND i.indpred IS NULL AND pg_get_expr(i.indexprs, i.indrelid) = '1')
      AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = $3
        AND table_name = 'syrve_integrations' AND column_name = 'configuration_revision'
        AND udt_name = 'uuid' AND is_nullable = 'NO') AS prepared`,
    [quotedSchema + '."syrve_integrations"', quotedSchema + '."syrve_table_links"', schemaName]);
    if (!schema.present) return { prepared: false, entity: null, links: [] };
    const query = manager.getRepository(SyrveIntegration).createQueryBuilder('settings')
      .select(LEGACY_COLUMNS.map((column) => `settings.${column}`)).orderBy('settings.createdAt', 'ASC').take(2);
    if (schema.prepared) query.addSelect('settings.configurationRevision');
    if (lock) query.setLock('pessimistic_write');
    const rows = await query.getMany();
    if (rows.length > 1) throw new ConflictException('Знайдено кілька налаштувань Syrve. Потрібна перевірка перед збереженням зв’язків.');
    const links = schema.prepared ? await manager.getRepository(SyrveTableLink).find() : [];
    return { prepared: Boolean(schema.prepared), entity: rows[0] || null, links };
  }

  async transaction<T>(expected: SyrveSettingsVersion,
    action: (manager: EntityManager, snapshot: SyrveSettingsSnapshot) => Promise<T>): Promise<T> {
    return this.localTransaction(async (manager) => {
      const snapshot = await this.read(manager, true);
      if (!snapshot.prepared) throw new ServiceUnavailableException('Серверна підготовка інтеграції ще не завершена. Збереження зв’язків поки недоступне.');
      const actual = settingsVersion(snapshot);
      if (actual.id !== expected.id || actual.revision !== expected.revision) throw staleSyrveSettings();
      return action(manager, snapshot);
    });
  }

  // Staff operations can use the same lock order before schema adoption or
  // while disconnected. Their caller decides whether durable state is present.
  async localTransaction<T>(action: (manager: EntityManager) => Promise<T>): Promise<T> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        // No upstream requests inside this short transaction. Bound lock waits.
        await manager.query("SET LOCAL lock_timeout = '750ms'");
        await manager.query("SET LOCAL statement_timeout = '5s'");
        await manager.query("SELECT pg_advisory_xact_lock(hashtext('molo-syrve'), hashtext('settings'))");
        return action(manager);
      });
    } catch (error) {
      const code = error?.driverError?.code || error?.code;
      if (code === '23505') throw new ConflictException('Стіл уже має інший зв’язок Syrve. Повторіть перевірку.');
      if (code === '23503') throw staleSyrveSettings();
      if (code === '55P03' || code === '57014') throw new ConflictException('Дані зараз змінюються. Повторіть перевірку за мить.');
      throw error;
    }
  }

  save(manager: EntityManager, value: Partial<SyrveIntegration>) {
    const repository = manager.getRepository(SyrveIntegration);
    return repository.save(repository.create({ ...value, configurationRevision: randomUUID() }));
  }
}
