// Versioned PostgreSQL 17 catalog reference of the frozen prepared migrations.
// It excludes data, credentials, unrelated tables and object OIDs. A difference
// requires an audit; names alone never establish an applied migration.
export const SYRVE_SCHEMA_REFERENCE: Readonly<Record<string, string>> = {
  CreateSyrveTableLinks2026093000010: '4a2061789e39e22b15b3863bacfd3567d04d0af636a3b817ed8b6161e89f1e6b',
  FenceSyrveConfiguration2026093000020: 'cb07638f3416ff0d2cba97527ba976de9184dd22eb88d72f3a801d9daacea39f',
  CreateTableMapIdentities2026093000030: '8c2902b110654f35ce8c52d1f7adee4622bfbf7309c0cf435912726e7212b50b',
  ProtectCanonicalTableNumbers2026093000040: '4167ee044a9cfe72419227b92ac8f057f218d7082811d205ed59d57f3202a459',
  CreateSyrveDurableState2026093000050: '09586d78110493eacd6e30c88c38f4973b400f0c9616e56af562ab7b31d3ee50',
  CreateSyrveWorkerState2026100100060: 'ae478dc3ba3c59021d35930e644b93f6a18fb5d0559d8ec785e08cf3323c0ee1',
};

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
