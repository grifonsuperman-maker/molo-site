import { ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';

import { TableEntity } from '../tables/entities/table.entity';
import { canonicalTableNumber, physicalMapSlot } from '../tables/table-map-slots';
import { rethrowTableNumberConflict } from '../tables/table-number-conflict';
import type { SyrveCatalog } from './syrve-catalog';
import { buildSyrveTableRenamePlan, RenameIdentity, RenameTable } from './syrve-table-rename-plan';
import { settingsVersion, staleSyrveSettings, SyrveSettingsSnapshot, SyrveSettingsStore,
  SyrveSettingsVersion } from './syrve-settings.store';

export type SyrveRenameObservation = { version: SyrveSettingsVersion; fingerprint: string; capturedAt: number };

@Injectable()
export class SyrveTableRenamingService {
  constructor(private readonly dataSource: DataSource, private readonly settings: SyrveSettingsStore) {}

  private schema() {
    const options = this.dataSource.options;
    const name = options?.type === 'postgres' ? options.schema || 'public' : 'public';
    return { name, quoted: '"' + name.replace(/"/g, '""') + '"' };
  }

  private async schemaState(manager = this.dataSource.manager) {
    const schema = this.schema();
    const [state] = await manager.query(`SELECT
      to_regclass($2) IS NOT NULL AS "physicalIdentityPrepared",
      EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relname = 'UQ_tables_canonical_number'
          AND i.indrelid = to_regclass($3) AND i.indisunique AND i.indisvalid AND i.indisready
          AND i.indimmediate AND i.indnkeyatts = 1 AND i.indnatts = 1 AND i.indpred IS NULL
          AND regexp_replace(replace(pg_get_expr(i.indexprs, i.indrelid), quote_ident($1) || '.', ''),
            '[()"[:space:]]', '', 'g') IN
            ('molo_canonical_table_numbertable_number', 'molo_canonical_table_numbertable_number::text')
          AND EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace pn ON pn.oid = p.pronamespace
            WHERE pn.nspname = $1 AND p.proname = 'molo_canonical_table_number'
              AND p.provolatile = 'i' AND p.proisstrict AND p.pronargs = 1
              AND p.proargtypes[0] = 'text'::regtype AND p.prorettype = 'text'::regtype)
      ) AS "numberUniquenessPrepared"`,
    [schema.name, schema.quoted + '."table_map_identities"', schema.quoted + '."tables"']);
    return { physicalIdentityPrepared: Boolean(state.physicalIdentityPrepared),
      numberUniquenessPrepared: Boolean(state.numberUniquenessPrepared) };
  }

  private async rows(manager: EntityManager, physicalIdentityPrepared: boolean) {
    const tables = await manager.getRepository(TableEntity).find({ select: { id: true, tableNumber: true } });
    const identities: RenameIdentity[] = physicalIdentityPrepared ? await manager.query(
      'SELECT "table_id" AS "tableId", "map_key" AS "mapKey" FROM ' + this.schema().quoted + '."table_map_identities"',
    ) : [];
    return { tables, identities };
  }

  private fingerprint(snapshot: SyrveSettingsSnapshot, tables: RenameTable[], identities: RenameIdentity[]) {
    const sorted = (values: unknown[]) => values.map((value) => JSON.stringify(value)).sort();
    return createHash('sha256').update(JSON.stringify({
      version: settingsVersion(snapshot), tables: sorted(tables.map(({ id, tableNumber }) => ({ id, tableNumber }))),
      identities: sorted(identities), links: sorted(snapshot.links.map(({ id, integrationId, organizationId,
        moloTableId, syrveTableId, lastKnownNumber }) =>
        ({ id, integrationId, organizationId, moloTableId, syrveTableId, lastKnownNumber }))),
    })).digest('hex');
  }

  private requireReady(snapshot: SyrveSettingsSnapshot, schema: Awaited<ReturnType<SyrveTableRenamingService['schemaState']>>) {
    if (!snapshot.prepared || !schema.physicalIdentityPrepared || !schema.numberUniquenessPrepared) {
      throw new ServiceUnavailableException('Безпечне перейменування столів ще не підготовлено на сервері.');
    }
    if (!snapshot.entity || snapshot.entity.status !== 'connected' || !snapshot.entity.organizationId ||
        !snapshot.entity.apiLoginEncrypted || !snapshot.entity.apiLoginIv || !snapshot.entity.apiLoginAuthTag) {
      throw new ConflictException('Спочатку підтвердьте підключення та UUID-зв’язки столів Syrve.');
    }
  }

  async diagnostics() {
    const snapshot = await this.settings.read();
    const schema = await this.schemaState();
    const { tables, identities } = await this.rows(this.dataSource.manager, schema.physicalIdentityPrepared);
    const links = snapshot.links.map((link) => {
      const table = tables.find((row) => row.id === link.moloTableId);
      const slot = physicalMapSlot(identities.find((identity) => identity.tableId === link.moloTableId)?.mapKey);
      return { moloTableId: link.moloTableId, syrveTableId: link.syrveTableId,
        currentNumber: table?.tableNumber || null, originalNumber: slot?.number || null,
        mapKey: slot?.key || null, location: slot?.location || null, lastKnownNumber: link.lastKnownNumber,
        photoLabelConflict: Boolean(slot && canonicalTableNumber(table?.tableNumber) !== slot.number) };
    });
    return { settingsPrepared: snapshot.prepared, ...schema,
      renamingReady: snapshot.prepared && schema.physicalIdentityPrepared && schema.numberUniquenessPrepared,
      renamingEnabled: false, syncEnabled: false, links,
      summary: { confirmedLinks: links.length, unboundLinks: links.filter((link) => !link.mapKey).length,
        photoLabelConflicts: links.filter((link) => link.photoLabelConflict).length } };
  }

  // Internal preparation for a future observer: capture BEFORE its HTTP request.
  // No controller/worker calls either mutation method in this stage.
  async capture(): Promise<SyrveRenameObservation> {
    const snapshot = await this.settings.read();
    const schema = await this.schemaState();
    this.requireReady(snapshot, schema);
    const { tables, identities } = await this.rows(this.dataSource.manager, true);
    const after = await this.settings.read();
    if (JSON.stringify(settingsVersion(snapshot)) !== JSON.stringify(settingsVersion(after))) throw staleSyrveSettings();
    return { version: settingsVersion(snapshot), fingerprint: this.fingerprint(snapshot, tables, identities), capturedAt: Date.now() };
  }

  async applyCatalog(catalog: SyrveCatalog, observation: SyrveRenameObservation) {
    return this.settings.transaction(observation.version, async (manager, snapshot) => {
      if (!Number.isFinite(observation.capturedAt) || observation.capturedAt > Date.now() ||
          Date.now() - observation.capturedAt > 5 * 60_000) throw staleSyrveSettings();
      // The same settings fence as mapping/disconnect; source then bindings.
      // Short local locks exclude inserts, renames, deletes and schema rollback.
      await manager.query('LOCK TABLE ' + this.schema().quoted + '."tables" IN SHARE ROW EXCLUSIVE MODE');
      const schema = await this.schemaState(manager);
      this.requireReady(snapshot, schema);
      await manager.query('LOCK TABLE ' + this.schema().quoted + '."table_map_identities" IN SHARE MODE');
      const { tables, identities } = await this.rows(manager, true);
      if (this.fingerprint(snapshot, tables, identities) !== observation.fingerprint ||
          catalog.organization.id !== snapshot.entity.organizationId ||
          snapshot.links.some((link) => link.integrationId !== snapshot.entity.id)) throw staleSyrveSettings();
      const plan = buildSyrveTableRenamePlan(catalog, tables, snapshot.links, identities);
      if (plan.conflicts.length) {
        throw new ConflictException({ message: 'Номери столів конфліктують або немає надійної прив’язки до карти. Жоден стіл не перейменовано.',
          conflicts: plan.conflicts });
      }
      try {
        for (const change of plan.changes) {
          // Raw, UUID-scoped update deliberately leaves updated_at and every
          // other physical field untouched. Never call findOrCreateByNumber.
          const [updated, affected] = await manager.query('UPDATE ' + this.schema().quoted + '."tables" SET "table_number"=$2 '
            + 'WHERE "id"=$1 AND "table_number"=$3 RETURNING "id"',
          [change.moloTableId, change.targetNumber, change.currentNumber]);
          if (affected !== 1 || updated.length !== 1) throw staleSyrveSettings();
        }
      } catch (error) { rethrowTableNumberConflict(error); }
      return { renamed: plan.changes.length, changes: plan.changes, skipped: plan.skipped,
        renamingEnabled: false, syncEnabled: false };
    });
  }
}
