import type { OrderObservationLink, SyrveOrderProbe } from './syrve-order-observer';

type VersionSupport = 'supported' | 'unsupported' | 'unknown';
type SupportCounts = Record<VersionSupport, number>;
export type SyrvePosVersions = { read: SupportCounts; initialization: SupportCounts };
export type SyrvePosVersionStatus = 'valid' | 'missing' | 'null' | 'empty' | 'invalid_type' | 'invalid_format';

const MINIMUM_READ = [7, 4, 6];
const MINIMUM_INITIALIZATION = [7, 7, 1];

// Only the documented terminal-group posVersion is evidence. Never infer the
// POS version from the cloud API version, an order timestamp or organization RMS.
export function normalizeSyrvePosVersion(value: unknown): string | null {
  if (typeof value !== 'string' || value !== value.trim()
    || !/^(?:0|[1-9]\d{0,4})(?:\.(?:0|[1-9]\d{0,4})){2,3}$/.test(value)) return null;
  return value;
}

// Preserve the reason at the transport boundary, before invalid values become
// null. Only fixed classifications and an already validated version may leave
// this function; arbitrary provider values must never reach diagnostics.
export function inspectSyrvePosVersion(value: unknown): { posVersion: string | null; posVersionStatus: SyrvePosVersionStatus } {
  const posVersion = normalizeSyrvePosVersion(value);
  const posVersionStatus: SyrvePosVersionStatus = posVersion !== null ? 'valid'
    : value === undefined ? 'missing' : value === null ? 'null'
      : typeof value !== 'string' ? 'invalid_type' : !value.trim() ? 'empty' : 'invalid_format';
  return { posVersion, posVersionStatus };
}

export function assessSyrvePosVersion(value: unknown) {
  const version = normalizeSyrvePosVersion(value);
  const supports = (minimum: number[]): VersionSupport => {
    if (!version) return 'unknown';
    const parts = version.split('.').map(Number);
    for (let i = 0; i < minimum.length; i++) {
      if (parts[i] !== minimum[i]) return parts[i] > minimum[i] ? 'supported' : 'unsupported';
    }
    return 'supported';
  };
  return { read: supports(MINIMUM_READ), initialization: supports(MINIMUM_INITIALIZATION) };
}

// Optional metadata cannot prove that a method is unsupported. Absent/null
// versions permit a guarded attempt, not a compatibility or visibility claim.
// Consent, successful loading and fresh reads remain mandatory for activation.
export function canAttemptSyrveInitialization(value: unknown, status?: SyrvePosVersionStatus) {
  return assessSyrvePosVersion(value).initialization === 'supported'
    || value === null && (status === 'missing' || status === 'null');
}

export function missingPosVersions(tables: number): SyrvePosVersions {
  return { read: { supported: 0, unsupported: 0, unknown: tables },
    initialization: { supported: 0, unsupported: 0, unknown: tables } };
}

export function diagnoseSyrvePosVersions(probe: SyrveOrderProbe, links: OrderObservationLink[]): SyrvePosVersions {
  const result = missingPosVersions(0);
  const catalogValid = ['connection', 'terminalGroups', 'restaurantSections']
    .every(key => probe.checks[key as keyof typeof probe.checks].status === 'ok');
  for (const link of links) {
    const tables = (probe.catalogTables || []).filter(table => table.id === link.syrveTableId);
    const table = tables.length === 1 && !tables[0].isDeleted ? tables[0] : null;
    const groups = (probe.terminalGroups?.active || []).filter(group => group.id === table?.terminalGroupId);
    const sleeping = probe.terminalGroups?.sleeping.some(group => group.id === table?.terminalGroupId);
    const version = catalogValid && table && groups.length === 1 && !sleeping ? groups[0].posVersion : null;
    const support = assessSyrvePosVersion(version);
    result.read[support.read]++;
    result.initialization[support.initialization]++;
  }
  return result;
}
