const assert = require('node:assert/strict');
const test = require('node:test');

function baseline(columns) {
  return {
    server: { database_name: 'molo', schema_name: 'public' },
    extensions: [],
    tables: [{ table_name: 'bookings' }],
    columns,
    enums: [],
    constraints: [],
    indexes: [],
    triggers: [],
    functions: [],
    sequences: [],
    views: [],
    typeOrmMigrations: [],
  };
}

function column(name, ordinalPosition, overrides = {}) {
  return {
    table_name: 'bookings',
    column_name: name,
    ordinal_position: ordinalPosition,
    data_type: 'text',
    udt_name: 'text',
    is_nullable: 'YES',
    column_default: null,
    character_maximum_length: null,
    numeric_precision: null,
    numeric_scale: null,
    datetime_precision: null,
    ...overrides,
  };
}

test('schema comparison ignores only physical column order', async () => {
  const { compareSchemaBaselines } = await import('../scripts/schema-roundtrip-compare.mjs');
  const expected = baseline([
    column('guest_name', 28),
    column('table_id', 29, { data_type: 'uuid', udt_name: 'uuid' }),
  ]);
  const actual = baseline([
    column('table_id', 28, { data_type: 'uuid', udt_name: 'uuid' }),
    column('guest_name', 29),
  ]);

  assert.doesNotThrow(() => compareSchemaBaselines(expected, actual));
});

test('schema comparison still rejects semantic column changes', async () => {
  const { compareSchemaBaselines } = await import('../scripts/schema-roundtrip-compare.mjs');
  const expected = baseline([column('guest_name', 28)]);
  const actual = baseline([
    column('guest_name', 29, {
      data_type: 'character varying',
      udt_name: 'varchar',
      character_maximum_length: 120,
    }),
  ]);

  assert.throws(
    () => compareSchemaBaselines(expected, actual),
    /mismatch in sections: columns/,
  );
});

test('schema comparison still rejects nullable/default changes', async () => {
  const { compareSchemaBaselines } = await import('../scripts/schema-roundtrip-compare.mjs');
  const expected = baseline([column('guest_name', 28)]);
  const actual = baseline([
    column('guest_name', 29, {
      is_nullable: 'NO',
      column_default: "''::text",
    }),
  ]);

  assert.throws(
    () => compareSchemaBaselines(expected, actual),
    /mismatch in sections: columns/,
  );
});
