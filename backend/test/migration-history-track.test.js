const assert = require('node:assert/strict');
const test = require('node:test');

const runtimeHistory = [
  'CreateStaffPinAttempts2026081400010',
  'UpgradeStaffPinAttemptsPerAttempt2026081400020',
  'CreateWaiterCalls2026081500010',
  'AddWaiterCallAssignmentActive2026081500015',
  'CloseInactiveWaiterCalls2026081500020',
];
const baseline = 'InitialSchemaBaseline2026081300000';
const probe = 'MigrationHistoryProbe2026081900010';

test('existing production history advances without an initial baseline row', async () => {
  const module = await import('../scripts/migration-history-track-validation.mjs');

  assert.equal(module.FUTURE_MIGRATION_PROBE, probe);
  assert.deepEqual(module.EXPECTED_EXISTING_TRACK_AFTER_PROBE, [
    ...runtimeHistory,
    probe,
  ]);
  assert.ok(!module.EXPECTED_EXISTING_TRACK_AFTER_PROBE.includes(baseline));
});

test('fresh history keeps the initial baseline before runtime and future migrations', async () => {
  const module = await import('../scripts/migration-history-track-validation.mjs');

  assert.deepEqual(module.EXPECTED_FRESH_TRACK_AFTER_PROBE, [
    baseline,
    ...runtimeHistory,
    probe,
  ]);
});
