import type { buildSyrveOrderObservation, ObservationCheckName } from './syrve-order-observer';

const CHECKS: readonly ObservationCheckName[] = ['connection', 'terminalGroups', 'restaurantSections',
  'posAvailability', 'ordersByTable', 'ordersById'];
const SAFE_CODES = new Set(['SYRVE_AUTH_FAILED', 'SYRVE_ACCESS_DENIED', 'SYRVE_RATE_LIMITED',
  'SYRVE_TIMEOUT', 'SYRVE_UNAVAILABLE', 'SYRVE_INVALID_RESPONSE', 'SYRVE_NO_ORGANIZATIONS',
  'SYRVE_ORGANIZATION_UNAVAILABLE', 'SYRVE_OBSERVATION_LIMIT']);

// The Director view receives counts and fixed diagnostics, never order UUIDs,
// provider payloads, credentials, or a receipt that could enable synchronization.
export function directorOrderDiagnostics(observation: ReturnType<typeof buildSyrveOrderObservation>
  & { configurationRevision: string }) {
  const countOrders = (state: 'open' | 'closed' | 'unknown') => observation.orders.filter(order => order.state === state).length;
  const countGroups = (state: 'alive' | 'sleeping' | 'offline' | 'unknown') => observation.terminalGroups.filter(group => group.state === state).length;
  return {
    configurationRevision: observation.configurationRevision, organizationId: observation.organizationId,
    startedAt: observation.startedAt, checkedAt: observation.checkedAt,
    checks: CHECKS.map(key => {
      const check = observation.checks[key];
      return { key, status: check.status, code: check.status === 'error'
        ? SAFE_CODES.has(check.code || '') ? check.code! : 'SYRVE_UNAVAILABLE' : null };
    }),
    summary: {
      linkedTables: observation.tables.length,
      tablesWithOpenOrders: observation.tables.filter(table => table.state === 'open').length,
      unknownTables: observation.tables.filter(table => table.state === 'unknown').length,
      observedOrders: observation.orders.length, openOrders: countOrders('open'),
      explicitlyClosedOrders: countOrders('closed'), unknownOrders: countOrders('unknown'),
      unresolvedKnownOrders: new Set(observation.tables.flatMap(table => table.unknownOrders.map(order => order.id))).size,
      terminalGroups: { alive: countGroups('alive'), sleeping: countGroups('sleeping'),
        offline: countGroups('offline'), unknown: countGroups('unknown') },
    },
    diagnostics: { complete: false as const, posOrderVisibility: 'not_verified' as const,
      posVersion: 'not_verified' as const, initializationPerformed: false as const },
    activationAvailable: false as const, syncEnabled: false as const,
    statusesApplied: false as const, renamingApplied: false as const,
  };
}
