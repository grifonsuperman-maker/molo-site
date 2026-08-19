const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

async function loadValidationScript() {
  return import(
    pathToFileURL(
      path.resolve(__dirname, '../scripts/initial-schema-baseline-validation.mjs'),
    ).href
  );
}

test('initial baseline history keeps baseline before runtime migrations on fresh databases', async () => {
  const {
    INITIAL_BASELINE_MIGRATION,
    EXPECTED_FRESH_BASELINE_HISTORY,
  } = await loadValidationScript();

  assert.equal(EXPECTED_FRESH_BASELINE_HISTORY[0], INITIAL_BASELINE_MIGRATION);
  assert.equal(EXPECTED_FRESH_BASELINE_HISTORY.length, 6);
});

test('initial baseline history comparison rejects missing or reordered migrations', async () => {
  const {
    EXPECTED_FRESH_BASELINE_HISTORY,
    assertMigrationNames,
  } = await loadValidationScript();

  assert.doesNotThrow(() =>
    assertMigrationNames(
      [...EXPECTED_FRESH_BASELINE_HISTORY],
      EXPECTED_FRESH_BASELINE_HISTORY,
    ),
  );

  assert.throws(
    () =>
      assertMigrationNames(
        [...EXPECTED_FRESH_BASELINE_HISTORY].reverse(),
        EXPECTED_FRESH_BASELINE_HISTORY,
      ),
    /Unexpected migration history/,
  );
});
