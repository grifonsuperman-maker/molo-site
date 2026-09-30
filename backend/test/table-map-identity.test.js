require('reflect-metadata');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');
const { getMetadataArgsStorage } = require('typeorm');
const { TABLE_MAP_SLOTS, canonicalTableNumber, legacyMapSlot } = require('../dist/tables/table-map-slots.js');
const { TableMapIdentity } = require('../dist/tables/entities/table-map-identity.entity.js');
const { TableMapIdentityService } = require('../dist/tables/table-map-identity.service.js');
const { TablesService } = require('../dist/tables/tables.service.js');
const { MapService } = require('../dist/map/map.service.js');
const { CreateTableMapIdentities2026093000030: Migration } = require('../dist/migrations/2026093000030-CreateTableMapIdentities.js');

function dataSource(tables = [], identities = [], prepared = true) {
  const queries = [];
  return {
    queries,
    query: async (sql, parameters) => {
      queries.push({ sql, parameters });
      if (sql.includes('to_regclass')) return [{ present: prepared }];
      assert.match(sql, /^SELECT "table_id"/);
      assert.deepEqual(parameters, [tables.map((table) => table.id)]);
      return identities;
    },
    getRepository: () => ({
      find: async (options) => {
        assert.deepEqual(options.select, { id: true, tableNumber: true });
        return tables;
      },
    }),
  };
}

function physicalTable(id = 'table-a', tableNumber = '12') {
  return { id, tableNumber, status: 'occupied', zone: { id: 'zone-a', name: 'Зал', isClosed: false },
    seats: 4, shape: 'rectangle', x: 27, y: 91, width: 170, height: 90,
    rotation: 13, photoUrl: '/existing-photo.jpg', isVisible: true };
}

test('frozen identity catalog matches the actually connected guest and admin maps', () => {
  const expected = TABLE_MAP_SLOTS.map((slot) => slot.key).sort();
  for (const file of ['guest/GuestApp.tsx', 'admin/AdminVisualTablePlanner.tsx']) {
    const source = fs.readFileSync(path.resolve(__dirname, '../../frontend/src', file), 'utf8');
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let initializer;
    function visit(node) {
      if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'LOCATIONS') initializer = node.initializer;
      ts.forEachChild(node, visit);
    }
    visit(ast);
    assert.ok(initializer, file);
    const locations = vm.runInNewContext('(' + initializer.getText(ast) + ')', {}, { timeout: 1000 });
    const actual = Array.from(locations, (location) => Array.from(location.tables, (table) => location.key + ':' + table.number)).flat().sort();
    assert.deepEqual(actual, expected, file);
  }
  assert.equal(TABLE_MAP_SLOTS.length, 60);
});

test('unknown, malformed and unsafe numbers never become a physical slot', () => {
  for (const number of ['77', '999', '0', '-12', '1.2', '1e1', '0x0c', 'x', '', null, '999999999999999999999']) {
    assert.equal(legacyMapSlot(number), null, String(number));
  }
  assert.equal(legacyMapSlot(' 0012 ').key, 'hall:12');
  assert.equal(canonicalTableNumber('000'), null);
});

test('identity schema is migration-owned and independent of Syrve', () => {
  const metadata = getMetadataArgsStorage().tables.find((item) => item.target === TableMapIdentity);
  assert.equal(metadata.name, 'table_map_identities');
  assert.equal(metadata.synchronize, false);
  assert.equal(getMetadataArgsStorage().relations.filter((item) => item.target === TableMapIdentity).length, 0);
  const app = fs.readFileSync(path.resolve(__dirname, '../src/app.module.ts'), 'utf8');
  const production = app.split('const staffPinMigrationOptions = {')[1].split('};')[0];
  assert.doesNotMatch(production, /CreateTableMapIdentities/);
  assert.match(app, /migrations: isDisposableSchemaReference[\s\S]*CreateTableMapIdentities2026093000030/);
});

test('legacy schema reads leave table objects and fields unchanged', async () => {
  const tables = [physicalTable()];
  const db = dataSource(tables, [], false);
  const before = structuredClone(tables);
  const result = await new TableMapIdentityService(db).project(tables);
  assert.equal(result.prepared, false);
  assert.equal(result.tables[0], tables[0]);
  assert.deepEqual(result.tables, before);
  assert.equal(Object.hasOwn(result.tables[0], 'mapKey'), false);
  assert.equal(db.queries.length, 1);
});

test('persisted UUID retains its physical slot and location after a number changes', async () => {
  const tables = [physicalTable('table-a', '77')];
  const before = structuredClone(tables);
  const db = dataSource(tables, [{ tableId: 'table-a', mapKey: 'hall:12' }]);
  const result = await new TableMapIdentityService(db).project(tables);
  assert.equal(result.prepared, true);
  assert.equal(result.tables[0].mapKey, 'hall:12');
  assert.equal(result.tables[0].mapLocation, 'hall');
  assert.deepEqual(tables, before);
  const { mapKey, mapLocation, ...physical } = result.tables[0];
  assert.deepEqual(physical, before[0]);
});

test('unbound table remains unbound; number matching never creates a binding on reads', async () => {
  const tables = [physicalTable('table-a', '12'), physicalTable('table-b', '77')];
  const db = dataSource(tables);
  const result = await new TableMapIdentityService(db).project(tables);
  assert.deepEqual(result.tables.map((table) => table.mapKey), [null, null]);
  assert.ok(db.queries.every(({ sql }) => sql.startsWith('SELECT')));
});

test('invalid stored key cannot place a table into an invented map slot', async () => {
  const tables = [physicalTable()];
  const db = dataSource(tables, [{ tableId: 'table-a', mapKey: 'hall:77' }]);
  const result = await new TableMapIdentityService(db).project(tables);
  assert.equal(result.tables[0].mapKey, null);
  assert.equal(result.tables[0].mapLocation, null);
  assert.equal((await new TableMapIdentityService(db).diagnostics()).unbound[0].reason, 'invalid_binding');
});

test('empty table list diagnoses the schema without reading or creating identities', async () => {
  const db = dataSource();
  assert.deepEqual(await new TableMapIdentityService(db).project([]), { prepared: true, tables: [] });
  assert.equal(db.queries.length, 1);
});

test('Director diagnostics explain duplicate, unsupported and unbound table numbers', async () => {
  const tables = [physicalTable('a', '12'), physicalTable('b', '012'), physicalTable('c', '77'),
    physicalTable('d', '14'), physicalTable('e', '15')];
  const db = dataSource(tables, [{ tableId: 'd', mapKey: 'hall:14' }]);
  const result = await new TableMapIdentityService(db).diagnostics();
  assert.deepEqual(result.summary, { physicalTables: 5, bound: 1, unbound: 4, numberConflicts: 1 });
  assert.deepEqual(result.numberConflicts, [{ number: '12', tableIds: ['a', 'b'] }]);
  assert.deepEqual(result.unbound.map((item) => item.reason),
    ['number_conflict', 'number_conflict', 'unsupported_number', 'not_bound']);
  assert.equal(result.mapConsumersReady, false);
  assert.equal(result.renamingEnabled, false);
  assert.equal(result.syncEnabled, false);
  assert.ok(db.queries.every(({ sql }) => sql.startsWith('SELECT')));
});

test('legacy Director diagnostic reports preparation rather than creating schema or rows', async () => {
  const db = dataSource([physicalTable()], [], false);
  const result = await new TableMapIdentityService(db).diagnostics();
  assert.equal(result.prepared, false);
  assert.equal(result.unbound[0].reason, 'schema_not_prepared');
  assert.equal(db.queries.length, 1);
});

test('tables API projects identity from the same read-only service', async () => {
  const tables = [physicalTable()];
  const identities = new TableMapIdentityService(dataSource(tables, [{ tableId: 'table-a', mapKey: 'hall:12' }]));
  const service = new TablesService({ find: async () => tables }, {}, {}, identities);
  assert.equal((await service.findAll())[0].mapKey, 'hall:12');
});

test('full and public map preserve physical fields, closed state and visibility filtering', async () => {
  const visibleZone = { id: 'zone-a', isVisible: true };
  const hiddenZone = { id: 'zone-hidden', isVisible: false };
  const tables = [physicalTable(), { ...physicalTable('hidden'), isVisible: false },
    { ...physicalTable('hidden-zone'), zone: hiddenZone }];
  const before = structuredClone(tables);
  // Real identity service, with a parameter-aware read-only database double.
  const db = dataSource();
  db.query = async (sql, parameters) => sql.includes('to_regclass') ? [{ present: true }]
    : parameters[0].map((id) => ({ tableId: id, mapKey: 'hall:12' }));
  const identities = new TableMapIdentityService(db);
  const service = new MapService({ find: async () => tables }, { find: async () => [visibleZone, hiddenZone] },
    { getRestaurant: async () => ({ id: 'restaurant', status: 'closed' }) }, { find: async () => [] }, identities);
  const full = await service.getFullMap();
  const publicMap = await service.getPublicMap();
  assert.equal(full.tables.length, 3);
  assert.equal(publicMap.tables.length, 1);
  assert.equal(publicMap.tables[0].id, 'table-a');
  assert.equal(publicMap.tables[0].status, 'occupied');
  assert.equal(publicMap.restaurant.status, 'closed');
  assert.deepEqual(publicMap.zones, [visibleZone]);
  assert.equal(publicMap.mapIdentityPrepared, true);
  assert.deepEqual(tables, before);
});

function runner(responses = [], active = true) {
  const queries = [];
  return { queries, isTransactionActive: active, query: async (sql) => {
    queries.push(sql);
    return responses.shift();
  } };
}

test('both migration directions refuse to run without a transaction', async () => {
  for (const direction of ['up', 'down']) {
    const db = runner([], false);
    await assert.rejects(new Migration()[direction](db), /requires an active transaction/);
    assert.equal(db.queries.length, 0);
  }
});

test('migration locks the source and inserts only unambiguous existing UUIDs', async () => {
  const db = runner();
  await new Migration().up(db);
  const sql = db.queries.join('\n');
  assert.match(sql, /LOCK TABLE "public"\."tables" IN SHARE MODE/);
  assert.match(sql, /WHERE candidates.matches = 1/);
  assert.match(sql, /FOREIGN KEY \("table_id"\)[\s\S]*REFERENCES "public"\."tables" \("id"\) ON DELETE CASCADE/);
  assert.match(sql, /UNIQUE \("map_key"\)/);
  assert.match(sql, /Physical map identity cannot be reassigned/);
  assert.doesNotMatch(sql, /(?:INSERT INTO|UPDATE|DELETE FROM|ALTER TABLE) "tables"/);
  assert.doesNotMatch(sql, /syrve|bookings|map_objects/i);
});

test('rollback retains every association that cannot be reconstructed exactly', async () => {
  const db = runner([[{ present: true }], [], [], [], [{ hasUnsafeIdentities: true }]]);
  await assert.rejects(new Migration().down(db), /non-reconstructable binding records exist/);
  assert.match(db.queries[2], /LOCK TABLE "public"\."tables" IN SHARE MODE/);
  assert.match(db.queries[3], /LOCK TABLE "public"\."table_map_identities" IN ACCESS EXCLUSIVE MODE/);
  assert.match(db.queries[4], /EXCEPT SELECT table_id, map_key FROM restorable/);
  assert.match(db.queries[4], /SELECT table_id, map_key FROM restorable EXCEPT/);
  assert.doesNotMatch(db.queries.join('\n'), /DROP/);
});

test('lossless rollback drops only reconstructable identities and the owned function', async () => {
  const db = runner([[{ present: true }], [], [], [], [{ hasUnsafeIdentities: false }], [], []]);
  await new Migration().down(db);
  assert.equal(db.queries[5], 'DROP TABLE "public"."table_map_identities"');
  assert.equal(db.queries[6], 'DROP FUNCTION "public"."molo_keep_table_map_identity"()');
  const absent = runner([[{ present: false }]]);
  await new Migration().down(absent);
  assert.equal(absent.queries.length, 1);
});

test('configured schema names are escaped and never become SQL instructions', async () => {
  const tables = [physicalTable()];
  const db = dataSource(tables);
  db.options = { type: 'postgres', schema: 'physical"probe' };
  await new TableMapIdentityService(db).project(tables);
  assert.deepEqual(db.queries[0].parameters, ['"physical""probe"."table_map_identities"']);
  assert.match(db.queries[1].sql, /FROM "physical""probe"\."table_map_identities"/);
});

test('PostgreSQL identity probe refuses unauthorized and remote targets before connecting', async () => {
  const { runTableMapIdentityValidation } = await import('../scripts/table-map-identity-validation.mjs');
  await assert.rejects(runTableMapIdentityValidation({}), /Fresh schema reference is disabled/);
  await assert.rejects(runTableMapIdentityValidation({
    FRESH_SCHEMA_REFERENCE_ALLOW: 'true', DB_URL: 'postgres://production.example/molo',
  }), /refuses DB_URL/);
});
