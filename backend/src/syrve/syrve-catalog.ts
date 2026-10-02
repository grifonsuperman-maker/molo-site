import { normalizeSyrvePosVersion } from './syrve-pos-version';

export class SyrveCatalogValidationError extends Error {}

type TerminalGroup = { id: string; name: string; posVersion?: string | null };
export type SyrveCatalogTable = {
  id: string;
  number: number;
  name: string;
  isDeleted: boolean;
  sectionId: string;
  sectionName: string;
  terminalGroupId: string;
};
export type SyrveCatalog = {
  organization: { id: string; name: string };
  terminalGroups: { active: TerminalGroup[]; sleeping: TerminalGroup[] };
  sectionsCount: number;
  tables: SyrveCatalogTable[];
};
type MoloTable = { id: string; tableNumber: string };
type ConflictCode = 'duplicate_syrve_id' | 'duplicate_syrve_number' | 'duplicate_molo_number'
  | 'unsupported_syrve_number' | 'unsupported_molo_number';

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SyrveCatalogValidationError();
  return value as Record<string, unknown>;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new SyrveCatalogValidationError();
  return value;
}
function uuid(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)) {
    throw new SyrveCatalogValidationError();
  }
  return value.toLowerCase();
}
function name(value: unknown): string {
  if (typeof value !== 'string' || value.length > 240) throw new SyrveCatalogValidationError();
  return value.trim();
}

export function parseTerminalGroups(payload: unknown, organizationId: string, includePosVersions = false) {
  const data = record(payload);
  const seen = new Set<string>();
  function groups(value: unknown): TerminalGroup[] {
    return array(value).flatMap((wrapper) => {
      const item = record(wrapper);
      if (uuid(item.organizationId) !== organizationId) throw new SyrveCatalogValidationError();
      return array(item.items).map((raw) => {
        const group = record(raw);
        const id = uuid(group.id);
        if (uuid(group.organizationId) !== organizationId || seen.has(id)) throw new SyrveCatalogValidationError();
        seen.add(id);
        if (seen.size > 100) throw new SyrveCatalogValidationError();
        return { id, name: name(group.name) || 'Група без назви',
          ...(includePosVersions ? { posVersion: normalizeSyrvePosVersion(group.posVersion) } : {}) };
      });
    });
  }
  return { active: groups(data.terminalGroups), sleeping: groups(data.terminalGroupsInSleep) };
}

export function parseRestaurantSections(payload: unknown, terminalGroupIds: string[]) {
  const sections = array(record(payload).restaurantSections);
  const seen = new Set<string>();
  const tables = sections.flatMap((raw) => {
    const section = record(raw);
    const sectionId = uuid(section.id);
    const terminalGroupId = uuid(section.terminalGroupId);
    if (seen.has(sectionId) || !terminalGroupIds.includes(terminalGroupId)) throw new SyrveCatalogValidationError();
    seen.add(sectionId);
    const sectionName = name(section.name);
    return array(section.tables).map((rawTable): SyrveCatalogTable => {
      const table = record(rawTable);
      if (typeof table.number !== 'number' || !Number.isInteger(table.number) ||
          table.number < -2_147_483_648 || table.number > 2_147_483_647 || typeof table.isDeleted !== 'boolean') {
        throw new SyrveCatalogValidationError();
      }
      return { id: uuid(table.id), number: table.number, name: name(table.name), isDeleted: table.isDeleted,
        sectionId, sectionName, terminalGroupId };
    });
  });
  return { sectionsCount: sections.length, tables };
}

function by<T>(values: T[], key: (value: T) => string) {
  const groups = new Map<string, T[]>();
  for (const value of values) {
    const id = key(value);
    const group = groups.get(id);
    if (group) group.push(value);
    else groups.set(id, [value]);
  }
  return groups;
}
function moloNumber(value: string): string | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const number = Number(trimmed);
  return Number.isInteger(number) && number <= 2_147_483_647 ? String(number) : null;
}

// Pure suggestions from complete validated responses; no repositories or writes.
export function buildSyrveCatalogPreview(catalog: SyrveCatalog, moloRows: MoloTable[]) {
  const moloTables = moloRows.map(({ id, tableNumber }) => ({ id, tableNumber }));
  const active = catalog.tables.filter((table) => !table.isDeleted);
  const deletedTables = catalog.tables.filter((table) => table.isDeleted);
  const ids = by(catalog.tables, (table) => table.id);
  const providerNumbers = by(active, (table) => String(table.number));
  const moloNumbers = by(moloTables.filter((table) => moloNumber(table.tableNumber) !== null),
    (table) => moloNumber(table.tableNumber)!);
  const conflicts: { code: ConflictCode; number: string | null; moloTableIds: string[]; syrveTableIds: string[] }[] = [];
  const addConflict = (code: ConflictCode, number: string | null, molo: MoloTable[], syrve: SyrveCatalogTable[]) => {
    conflicts.push({ code, number, moloTableIds: molo.map((table) => table.id), syrveTableIds: [...new Set(syrve.map((table) => table.id))] });
  };
  for (const tables of ids.values()) {
    if (tables.length > 1) addConflict('duplicate_syrve_id', null, [], tables);
  }
  for (const [number, tables] of providerNumbers) {
    if (tables.length > 1) addConflict('duplicate_syrve_number', number, moloNumbers.get(number) || [], tables);
    if (tables[0].number < 0) addConflict('unsupported_syrve_number', number, [], tables);
  }
  for (const [number, tables] of moloNumbers) {
    if (tables.length > 1) addConflict('duplicate_molo_number', number, tables, providerNumbers.get(number) || []);
  }
  for (const table of moloTables) {
    if (moloNumber(table.tableNumber) === null) addConflict('unsupported_molo_number', table.tableNumber, [table], []);
  }
  const proposals: { moloTableId: string; moloTableNumber: string; syrveTableId: string; syrveTableNumber: number; sectionName: string }[] = [];
  const missingInMolo: SyrveCatalogTable[] = [];
  for (const table of active) {
    const number = String(table.number);
    if (table.number < 0 || ids.get(table.id)!.length !== 1 || providerNumbers.get(number)!.length !== 1) continue;
    const matches = moloNumbers.get(number) || [];
    if (!matches.length) missingInMolo.push(table);
    if (matches.length === 1) proposals.push({ moloTableId: matches[0].id, moloTableNumber: matches[0].tableNumber,
      syrveTableId: table.id, syrveTableNumber: table.number, sectionName: table.sectionName });
  }
  const missingInSyrve = moloTables.filter((table) => {
    const number = moloNumber(table.tableNumber);
    return number !== null && moloNumbers.get(number)!.length === 1 && !providerNumbers.has(number);
  });
  const warnings: string[] = [
    'Отримано лише секції, доступні для бронювання через Syrve API. Повноту всіх столів ресторану ще не підтверджено.',
    'Читання стану столів ще не перевірено. Синхронізацію не ввімкнено.',
  ];
  if (catalog.terminalGroups.sleeping.length) warnings.push('Частина касових груп Syrve неактивна; їхні столи не перевірено.');
  if (!catalog.terminalGroups.active.length) warnings.push('У вибраній організації немає активних касових груп.');
  if (!active.length) warnings.push('У доступних секціях Syrve не знайдено активних столів.');
  return {
    organization: catalog.organization,
    checkedAt: new Date().toISOString(),
    summary: { syrveTables: new Set(active.map((table) => table.id)).size, proposals: proposals.length,
      missingInMolo: missingInMolo.length, missingInSyrve: missingInSyrve.length, conflicts: conflicts.length,
      deletedTables: new Set(deletedTables.map((table) => table.id)).size },
    proposals, missingInMolo, missingInSyrve, conflicts, deletedTables,
    diagnostics: { terminalGroups: catalog.terminalGroups, sectionsCount: catalog.sectionsCount,
      catalogScope: 'available_restaurant_sections' as const, orders: 'not_checked' as const, warnings },
    mappingConfirmationAvailable: false as const,
    syncEnabled: false as const,
  };
}
