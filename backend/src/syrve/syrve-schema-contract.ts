// Versioned PostgreSQL 17 catalog reference of the frozen prepared migrations.
// It excludes data, credentials, unrelated tables and object OIDs. A difference
// requires an audit; names alone never establish an applied migration.
export const SYRVE_SCHEMA_REFERENCE: Readonly<Record<string, string>> = {};

export const SYRVE_SCHEMA_STEPS = [
  { name: 'CreateSyrveTableLinks2026093000010', tables: ['syrve_table_links'] },
  { name: 'FenceSyrveConfiguration2026093000020', tables: [] },
  { name: 'CreateTableMapIdentities2026093000030', tables: ['table_map_identities'] },
  { name: 'ProtectCanonicalTableNumbers2026093000040', tables: [] },
  { name: 'CreateSyrveDurableState2026093000050', tables: ['syrve_table_sync_states', 'syrve_order_versions'] },
  { name: 'CreateSyrveWorkerState2026100100060', tables: ['syrve_worker_state'] },
] as const;
export const SYRVE_EXISTING_HISTORY = ['CreateStaffPinAttempts2026081400010', 'UpgradeStaffPinAttemptsPerAttempt2026081400020',
  'CreateWaiterCalls2026081500010', 'AddWaiterCallAssignmentActive2026081500015', 'CloseInactiveWaiterCalls2026081500020',
  'AddGuestReviewArchive2026082200010', 'AddLogArchive2026082400010', 'AddManualBookingGuestName2026082400020'];
