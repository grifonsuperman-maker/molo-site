const assert = require('node:assert/strict');
const test = require('node:test');

function createSnapshot() {
  return {
    capturedAt: '2026-08-18T00:00:00.000Z',
    server: {
      database_name: 'neondb',
      schema_name: 'public',
      server_version: '17.10',
    },
    extensions: [{ version: '1.1', name: 'uuid-ossp' }],
    tables: [{ table_name: 'bookings' }],
    columns: [
      {
        table_name: 'bookings',
        ordinal_position: 1,
        column_name: 'id',
      },
    ],
    enums: [
      { enum_name: 'bookings_status_enum', sort_order: 1, value: 'pending' },
      { enum_name: 'bookings_status_enum', sort_order: 2, value: 'approved' },
    ],
    constraints: [
      {
        table_name: 'bookings',
        constraint_name: 'PK_bookings',
        definition: 'PRIMARY KEY (id)',
      },
    ],
    indexes: [
      {
        table_name: 'bookings',
        index_name: 'UQ_bookings_active_guest_phone_date',
        definition: 'CREATE UNIQUE INDEX ...',
      },
    ],
    triggers: [
      {
        table_name: 'bookings',
        trigger_name: 'TRG_bookings_close_waiter_calls_when_inactive',
        enabled_state: 'O',
        definition: 'CREATE TRIGGER ...',
      },
    ],
    functions: [
      {
        schema_name: 'public',
        function_name: 'close_waiter_calls_when_booking_inactive',
        identity_arguments: '',
        function_kind: 'f',
        definition: 'CREATE OR REPLACE FUNCTION ...',
      },
    ],
    sequences: [
      {
        schema_name: 'public',
        sequence_name: 'staff_pin_attempts_id_seq',
        owned_by_table: 'staff_pin_attempts',
        owned_by_column: 'id',
        ownership_dependency_type: 'a',
      },
    ],
    views: [],
    typeOrmMigrations: [
      {
        id: 5,
        timestamp: '2026081500020',
        name: 'CloseInactiveWaiterCalls2026081500020',
      },
    ],
  };
}

test('schema baseline removes volatile capture metadata but preserves schema metadata', async () => {
  const { normalizeSchemaSnapshot } = await import('../scripts/schema-baseline.mjs');
  const baseline = normalizeSchemaSnapshot(createSnapshot());

  assert.equal('capturedAt' in baseline, false);
  assert.equal('server_version' in baseline.server, false);
  assert.equal(baseline.server.database_name, 'neondb');
  assert.equal(baseline.server.schema_name, 'public');

  assert.equal(baseline.triggers[0].enabled_state, 'O');
  assert.equal(
    baseline.functions[0].function_name,
    'close_waiter_calls_when_booking_inactive',
  );
  assert.equal(
    baseline.sequences[0].owned_by_table,
    'staff_pin_attempts',
  );
  assert.equal(
    baseline.typeOrmMigrations[0].name,
    'CloseInactiveWaiterCalls2026081500020',
  );
});

test('schema baseline preserves audit array order, including enum order', async () => {
  const { normalizeSchemaSnapshot } = await import('../scripts/schema-baseline.mjs');
  const baseline = normalizeSchemaSnapshot(createSnapshot());

  assert.deepEqual(
    baseline.enums.map((row) => row.value),
    ['pending', 'approved'],
  );
});

test('schema baseline produces deterministic object key ordering', async () => {
  const { normalizeSchemaSnapshot } = await import('../scripts/schema-baseline.mjs');
  const baseline = normalizeSchemaSnapshot(createSnapshot());

  assert.deepEqual(Object.keys(baseline), [...Object.keys(baseline)].sort());
  assert.deepEqual(
    Object.keys(baseline.extensions[0]),
    [...Object.keys(baseline.extensions[0])].sort(),
  );
});

test('schema baseline rejects incomplete snapshots instead of silently accepting them', async () => {
  const { normalizeSchemaSnapshot } = await import('../scripts/schema-baseline.mjs');
  const snapshot = createSnapshot();
  delete snapshot.indexes;

  assert.throws(
    () => normalizeSchemaSnapshot(snapshot),
    /missing the indexes array/,
  );
});
