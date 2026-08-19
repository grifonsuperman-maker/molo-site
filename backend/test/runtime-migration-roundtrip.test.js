const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

async function importScript(name) {
  return import(
    pathToFileURL(path.resolve(__dirname, `../scripts/${name}`)).href
  );
}

test('runtime migration history must match the exact registered order', async () => {
  const {
    EXPECTED_RUNTIME_MIGRATIONS,
    assertMigrationHistory,
  } = await importScript('runtime-migration-roundtrip.mjs');

  assert.doesNotThrow(() =>
    assertMigrationHistory(
      [...EXPECTED_RUNTIME_MIGRATIONS],
      EXPECTED_RUNTIME_MIGRATIONS,
    ),
  );

  assert.throws(
    () =>
      assertMigrationHistory(
        [...EXPECTED_RUNTIME_MIGRATIONS].reverse(),
        EXPECTED_RUNTIME_MIGRATIONS,
      ),
    /Unexpected migration history/,
  );
});

test('rewind state assertion rejects a leftover migration object', async () => {
  const { assertRewindState } = await importScript(
    'runtime-migration-roundtrip.mjs',
  );

  assert.doesNotThrow(() =>
    assertRewindState(
      {
        waiterAssignmentActiveColumn: false,
        waiterAssignmentIndex: false,
        waiterStatusIndex: true,
      },
      {
        waiterAssignmentActiveColumn: false,
        waiterAssignmentIndex: false,
        waiterStatusIndex: true,
      },
      'test checkpoint',
    ),
  );

  assert.throws(
    () =>
      assertRewindState(
        {
          waiterAssignmentActiveColumn: true,
          waiterAssignmentIndex: false,
          waiterStatusIndex: true,
        },
        {
          waiterAssignmentActiveColumn: false,
          waiterAssignmentIndex: false,
          waiterStatusIndex: true,
        },
        'test checkpoint',
      ),
    /Unexpected rewind state test checkpoint: waiterAssignmentActiveColumn/,
  );
});

test('schema roundtrip comparison ignores only TypeORM migration row ids', async () => {
  const { compareSchemaBaselines } = await importScript(
    'schema-roundtrip-compare.mjs',
  );

  const expected = {
    tables: [{ table_name: 'bookings' }],
    indexes: [{ index_name: 'IDX_bookings_date' }],
    typeOrmMigrations: [
      { id: 1, name: 'MigrationA', timestamp: '1' },
      { id: 2, name: 'MigrationB', timestamp: '2' },
    ],
  };
  const actual = {
    tables: [{ table_name: 'bookings' }],
    indexes: [{ index_name: 'IDX_bookings_date' }],
    typeOrmMigrations: [
      { id: 6, name: 'MigrationA', timestamp: '1' },
      { id: 7, name: 'MigrationB', timestamp: '2' },
    ],
  };

  assert.doesNotThrow(() => compareSchemaBaselines(expected, actual));
});

test('schema roundtrip comparison fails on real schema drift', async () => {
  const { compareSchemaBaselines } = await importScript(
    'schema-roundtrip-compare.mjs',
  );

  assert.throws(
    () =>
      compareSchemaBaselines(
        {
          tables: [{ table_name: 'bookings' }],
          indexes: [{ index_name: 'IDX_bookings_date' }],
          typeOrmMigrations: [],
        },
        {
          tables: [{ table_name: 'bookings' }],
          indexes: [],
          typeOrmMigrations: [],
        },
      ),
    /Schema roundtrip mismatch in sections: indexes/,
  );
});
