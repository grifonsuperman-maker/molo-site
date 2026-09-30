import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { TableEntity } from './entities/table.entity';
import { canonicalTableNumber, legacyMapSlot, physicalMapSlot } from './table-map-slots';

type PhysicalTable = { id: string; tableNumber: string };
type Identity = { tableId: string; mapKey: string };

@Injectable()
export class TableMapIdentityService {
  constructor(private readonly dataSource: DataSource) {}

  private async identities(tableIds: string[]) {
    const options = this.dataSource.options;
    const schemaName = options?.type === 'postgres' ? options.schema || 'public' : 'public';
    const relation = '"' + schemaName.replace(/"/g, '""') + '"."table_map_identities"';
    const [state] = await this.dataSource.query(
      'SELECT to_regclass($1) IS NOT NULL AS present', [relation],
    );
    if (!state.present) return { prepared: false, identities: [] as Identity[] };
    if (!tableIds.length) return { prepared: true, identities: [] as Identity[] };
    const identities: Identity[] = await this.dataSource.query(
      'SELECT "table_id" AS "tableId", "map_key" AS "mapKey" FROM ' + relation + ' WHERE "table_id" = ANY($1::uuid[])',
      [tableIds],
    );
    return { prepared: true, identities };
  }

  async project<T extends PhysicalTable>(tables: T[]) {
    const snapshot = await this.identities(tables.map((table) => table.id));
    const byId = new Map(snapshot.identities.map((identity) => [identity.tableId, identity]));
    return {
      prepared: snapshot.prepared,
      tables: tables.map((table) => {
        if (!snapshot.prepared) return table;
        const slot = physicalMapSlot(byId.get(table.id)?.mapKey);
        return { ...table, mapKey: slot?.key || null, mapLocation: slot?.location || null };
      }),
    };
  }

  async diagnostics() {
    const tables = await this.dataSource.getRepository(TableEntity).find({
      select: { id: true, tableNumber: true },
      order: { tableNumber: 'ASC' },
    });
    const snapshot = await this.identities(tables.map((table) => table.id));
    const identities = new Map(snapshot.identities.map((identity) => [identity.tableId, identity]));
    const byNumber = new Map<string, string[]>();
    for (const table of tables) {
      const number = canonicalTableNumber(table.tableNumber);
      if (number) byNumber.set(number, [...(byNumber.get(number) || []), table.id]);
    }
    const numberConflicts = [...byNumber].filter(([, ids]) => ids.length > 1)
      .map(([number, tableIds]) => ({ number, tableIds }));
    const bound = [];
    const unbound = [];
    for (const table of tables) {
      const identity = identities.get(table.id);
      const slot = physicalMapSlot(identity?.mapKey);
      if (slot) {
        bound.push({ tableId: table.id, tableNumber: table.tableNumber,
          mapKey: slot.key, location: slot.location, originalNumber: slot.number });
        continue;
      }
      const number = canonicalTableNumber(table.tableNumber);
      const reason = !snapshot.prepared ? 'schema_not_prepared'
        : identity ? 'invalid_binding'
        : number && (byNumber.get(number)?.length || 0) > 1 ? 'number_conflict'
        : !legacyMapSlot(table.tableNumber) ? 'unsupported_number' : 'not_bound';
      unbound.push({ tableId: table.id, tableNumber: table.tableNumber, reason });
    }
    return {
      prepared: snapshot.prepared,
      summary: { physicalTables: tables.length, bound: bound.length,
        unbound: unbound.length, numberConflicts: numberConflicts.length },
      bound, unbound, numberConflicts,
      mapConsumersReady: snapshot.prepared,
      renamingEnabled: false,
      syncEnabled: false,
    };
  }
}
