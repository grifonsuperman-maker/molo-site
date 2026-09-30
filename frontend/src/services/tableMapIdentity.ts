import type { TableItem } from '../api/types';

const LOCATION_RANGES = {
  hall: [1, 14],
  canopy: [15, 20],
  gazebo: [21, 36],
  rotang: [37, 39],
  embankment: [40, 44],
  glass_gazebo: [45, 50],
  water_gazebo: [100, 109],
} as const;

type LocationKey = keyof typeof LOCATION_RANGES;
type IdentityTable = Pick<TableItem, 'id' | 'tableNumber' | 'mapKey' | 'mapLocation'>;

// Numbers inside map keys are frozen physical slot labels, not current table numbers.
export function physicalMapSlot(key: unknown) {
  if (typeof key !== 'string') return null;
  const match = /^([a-z_]+):([1-9]\d*)$/.exec(key);
  if (!match || !Object.prototype.hasOwnProperty.call(LOCATION_RANGES, match[1])) return null;
  const location = match[1] as LocationKey;
  const number = Number(match[2]);
  const [from, to] = LOCATION_RANGES[location];
  if (number < from || number > to) return null;
  return { key, location, number };
}

export function hasPreparedMapIdentity(tables: readonly IdentityTable[], prepared?: boolean) {
  return prepared === true || tables.some((table) =>
    table.mapKey !== undefined || table.mapLocation !== undefined,
  );
}

export function tableMapLocation(table: IdentityTable, prepared: boolean) {
  if (prepared || table.mapKey !== undefined || table.mapLocation !== undefined) {
    return physicalMapSlot(table.mapKey)?.location || null;
  }
  // Only legacy responses retain the existing number-range grouping.
  const number = Number(table.tableNumber);
  return (Object.keys(LOCATION_RANGES) as LocationKey[]).find((location) => {
    const [from, to] = LOCATION_RANGES[location];
    return number >= from && number <= to;
  }) || null;
}

export function findTableForMapSlot<T extends IdentityTable>(
  tables: readonly T[], location: string, originalNumber: number, prepared?: boolean,
): T | null {
  if (!hasPreparedMapIdentity(tables, prepared)) {
    return tables.find((table) => Number(table.tableNumber) === originalNumber) || null;
  }
  const key = `${location}:${originalNumber}`;
  if (!physicalMapSlot(key)) return null;
  const matches = tables.filter((table) => table.mapKey === key);
  // Never borrow a different UUID by its current number, including an unbound table.
  return matches.length === 1 ? matches[0] : null;
}
