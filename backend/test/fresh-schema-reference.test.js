const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

async function loadFreshSchemaReference() {
  const modulePath = path.resolve(
    __dirname,
    '../scripts/fresh-schema-reference.mjs',
  );
  return import(pathToFileURL(modulePath).href);
}

function safeEnv(overrides = {}) {
  return {
    FRESH_SCHEMA_REFERENCE_ALLOW: 'true',
    DB_HOST: '127.0.0.1',
    DB_NAME: 'molo_fresh_schema_reference',
    DB_SYNCHRONIZE: 'true',
    ...overrides,
  };
}

test('fresh schema reference accepts only the explicit isolated loopback target', async () => {
  const { assertFreshSchemaReferenceTarget } =
    await loadFreshSchemaReference();

  assert.doesNotThrow(() => assertFreshSchemaReferenceTarget(safeEnv()));
  assert.doesNotThrow(() =>
    assertFreshSchemaReferenceTarget(safeEnv({ DB_HOST: 'localhost' })),
  );
  assert.doesNotThrow(() =>
    assertFreshSchemaReferenceTarget(safeEnv({ DB_HOST: '::1' })),
  );
});

test('fresh schema reference requires an explicit enable flag', async () => {
  const { assertFreshSchemaReferenceTarget } =
    await loadFreshSchemaReference();

  assert.throws(
    () =>
      assertFreshSchemaReferenceTarget(
        safeEnv({ FRESH_SCHEMA_REFERENCE_ALLOW: 'false' }),
      ),
    /Fresh schema reference is disabled/,
  );
});

test('fresh schema reference rejects DB_URL even when it points to localhost', async () => {
  const { assertFreshSchemaReferenceTarget } =
    await loadFreshSchemaReference();

  assert.throws(
    () =>
      assertFreshSchemaReferenceTarget(
        safeEnv({
          DB_URL:
            'postgres://postgres:postgres@127.0.0.1:5432/molo_fresh_schema_reference',
        }),
      ),
    /refuses DB_URL/,
  );
});

test('fresh schema reference rejects remote database hosts', async () => {
  const { assertFreshSchemaReferenceTarget } =
    await loadFreshSchemaReference();

  for (const host of [
    'db.example.com',
    'ep-production.neon.tech',
    '10.0.0.20',
  ]) {
    assert.throws(
      () => assertFreshSchemaReferenceTarget(safeEnv({ DB_HOST: host })),
      /requires DB_HOST to be localhost, 127\.0\.0\.1 or ::1/,
    );
  }
});

test('fresh schema reference rejects a different database name', async () => {
  const { assertFreshSchemaReferenceTarget } =
    await loadFreshSchemaReference();

  assert.throws(
    () =>
      assertFreshSchemaReferenceTarget(
        safeEnv({ DB_NAME: 'molo_restaurant' }),
      ),
    /requires DB_NAME=molo_fresh_schema_reference/,
  );
});

test('fresh schema reference requires synchronize only on the disposable database', async () => {
  const { assertFreshSchemaReferenceTarget } =
    await loadFreshSchemaReference();

  assert.throws(
    () =>
      assertFreshSchemaReferenceTarget(
        safeEnv({ DB_SYNCHRONIZE: 'false' }),
      ),
    /requires DB_SYNCHRONIZE=true/,
  );
});
