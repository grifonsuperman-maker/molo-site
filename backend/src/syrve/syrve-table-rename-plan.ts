import type { SyrveTableLink } from './entities/syrve-table-link.entity';
import type { SyrveCatalog } from './syrve-catalog';
import { canonicalTableNumber, physicalMapSlot } from '../tables/table-map-slots';

export type RenameTable = { id: string; tableNumber: string };
export type RenameIdentity = { tableId: string; mapKey: string };
export type RenameDiagnostic = { code: string; moloTableId: string | null; syrveTableId: string | null;
  currentNumber: string | null; targetNumber: string | null };

export function buildSyrveTableRenamePlan(catalog: SyrveCatalog, tables: RenameTable[],
  links: SyrveTableLink[], identities: RenameIdentity[]) {
  const changes: { moloTableId: string; syrveTableId: string; currentNumber: string;
    targetNumber: string; mapKey: string; originalNumber: string }[] = [];
  const conflicts: RenameDiagnostic[] = [];
  const skipped: RenameDiagnostic[] = [];
  const numbers = new Map<string, string[]>();
  for (const table of tables) {
    const number = canonicalTableNumber(table.tableNumber);
    if (number) numbers.set(number, [...(numbers.get(number) || []), table.id]);
  }
  for (const [number, ids] of numbers) {
    if (ids.length > 1) conflicts.push({ code: 'duplicate_molo_number', moloTableId: null,
      syrveTableId: null, currentNumber: number, targetNumber: null });
  }
  for (const link of links) {
    const table = tables.find((row) => row.id === link.moloTableId);
    const providers = catalog.tables.filter((row) => row.id === link.syrveTableId);
    const result = (code: string, targetNumber: string | null = null): RenameDiagnostic => ({ code,
      moloTableId: link.moloTableId, syrveTableId: link.syrveTableId,
      currentNumber: table?.tableNumber || null, targetNumber });
    if (link.organizationId !== catalog.organization.id) {
      conflicts.push(result('foreign_organization')); continue;
    }
    if (!table) { conflicts.push(result('missing_molo_table')); continue; }
    const bindings = identities.filter((identity) => identity.tableId === table.id);
    const slot = bindings.length === 1 ? physicalMapSlot(bindings[0].mapKey) : null;
    if (!slot || identities.filter((identity) => identity.mapKey === slot.key).length !== 1) {
      conflicts.push(result('missing_physical_identity')); continue;
    }
    if (!providers.length) { skipped.push(result('missing_syrve_table')); continue; }
    if (providers.length !== 1) { conflicts.push(result('duplicate_syrve_id')); continue; }
    const provider = providers[0];
    if (provider.isDeleted) { skipped.push(result('deleted_syrve_table')); continue; }
    if (!Number.isInteger(provider.number) || provider.number < 1 || provider.number > 2_147_483_647) {
      conflicts.push(result('unsupported_syrve_number')); continue;
    }
    const targetNumber = String(provider.number);
    if (catalog.tables.filter((row) => !row.isDeleted && row.number === provider.number).length !== 1) {
      conflicts.push(result('duplicate_syrve_number', targetNumber)); continue;
    }
    // Occupied targets, including swaps/chains, block the entire batch. No
    // temporary numbers, reassignment, inserts or physical map changes.
    if ((numbers.get(targetNumber) || []).some((id) => id !== table.id)) {
      conflicts.push(result('number_in_use', targetNumber)); continue;
    }
    if (table.tableNumber !== targetNumber) changes.push({ moloTableId: table.id,
      syrveTableId: link.syrveTableId, currentNumber: table.tableNumber, targetNumber,
      mapKey: slot.key, originalNumber: slot.number });
  }
  return { changes, conflicts, skipped };
}
