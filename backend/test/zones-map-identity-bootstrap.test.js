require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const { ZonesService } = require('../dist/zones/zones.service.js');
const { ZonesModule } = require('../dist/zones/zones.module.js');
const { TableMapIdentityModule } = require('../dist/tables/table-map-identity.module.js');

const locationNames = ['Зал ресторану', 'Навіс', 'Велика альтанка', 'Ротанг',
  'Набережна', 'Скляна альтанка', 'Альтанка на воді'];

function harness(prepared, initialTables = []) {
  const calls = { creates: [], saves: [], identity: [], restaurant: 0, zoneWrites: 0 };
  const tables = structuredClone(initialTables);
  const zones = locationNames.map((name, index) => ({ id: 'zone-' + index, name, tables: [] }));
  const service = new ZonesService({
    find: async () => zones,
    create: () => { calls.zoneWrites++; assert.fail('existing zones must not be recreated'); },
    save: async () => { calls.zoneWrites++; assert.fail('existing zones must not be rewritten'); },
  }, {
    find: async () => { calls.restaurant++; return [{ id: 'restaurant' }]; },
  }, {
    find: async () => tables,
    create: (input) => { calls.creates.push(input); return { id: 'new-' + input.tableNumber, ...input }; },
    save: async (rows) => {
      calls.saves.push(structuredClone(rows));
      for (const row of rows) if (!tables.some((table) => table.id === row.id)) tables.push(row);
      return rows;
    },
  }, {
    project: async (rows) => { calls.identity.push(rows); return { prepared, tables: rows }; },
  });
  return { service, calls, tables, zones };
}

test('legacy first boot still seeds the same 60 slots and reconciles the same existing zone', async () => {
  const h = harness(false, [{ id: 'table-12', tableNumber: '12', zone: { id: 'old-zone' },
    status: 'cleaning', x: 27, y: 91, width: 170, height: 90, rotation: 13, photoUrl: '/existing.jpg' }]);
  const before = structuredClone(h.tables[0]);
  await h.service.onModuleInit();
  assert.equal(h.tables.length, 60);
  assert.equal(h.calls.creates.length, 59);
  assert.equal(h.calls.saves.length, 1);
  assert.equal(h.tables[0].zone.id, 'zone-0');
  const { zone, ...physical } = h.tables[0];
  const { zone: originalZone, ...original } = before;
  assert.deepEqual(physical, original);
  assert.equal(h.tables.find((row) => row.tableNumber === '5').seats, 6);
  assert.equal(h.tables.find((row) => row.tableNumber === '109').seats, 4);
  await h.service.onModuleInit();
  assert.equal(h.tables.length, 60);
  assert.equal(h.calls.saves.length, 1, 'unchanged legacy restart stays idempotent');
});

test('prepared restart preserves renamed, swapped, hidden and unbound physical UUIDs without any bootstrap write', async () => {
  const h = harness(true, [
    { id: 'hall-12', tableNumber: '15', mapKey: 'hall:12', zone: { id: 'custom-hall' }, status: 'occupied' },
    { id: 'canopy-15', tableNumber: '12', mapKey: 'canopy:15', zone: { id: 'custom-canopy' }, isVisible: false },
    { id: 'renamed', tableNumber: '77', mapKey: 'hall:14', zone: { id: 'custom-hall' }, status: 'cleaning' },
    { id: 'unbound', tableNumber: '3', mapKey: null, zone: { id: 'custom-zone' } },
  ]);
  const before = structuredClone(h.tables);
  for (let i = 0; i < 3; i++) await h.service.onModuleInit();
  assert.deepEqual(h.tables, before);
  assert.equal(h.calls.creates.length, 0);
  assert.equal(h.calls.saves.length, 0);
  assert.equal(h.calls.restaurant, 0);
  assert.equal(h.calls.zoneWrites, 0);
  assert.deepEqual(h.calls.identity, [[], [], []]);
});

test('prepared empty catalog never recreates intentionally deleted slots', async () => {
  const h = harness(true);
  assert.equal(await h.service.ensureDefaultLocations(), h.zones);
  assert.deepEqual(h.tables, []);
  assert.equal(h.calls.creates.length, 0);
  assert.equal(h.calls.restaurant, 0);
});

test('identity read failure stops bootstrap before changing restaurant, zones or tables', async () => {
  const h = harness(false);
  h.service.mapIdentities.project = async () => { throw new Error('identity read failed'); };
  await assert.rejects(h.service.onModuleInit(), /identity read failed/);
  assert.equal(h.calls.restaurant, 0);
  assert.equal(h.calls.creates.length, 0);
  assert.equal(h.calls.zoneWrites, 0);
});

test('ZonesModule wires the same physical identity service used by table and map reads', () => {
  assert.ok(Reflect.getMetadata('imports', ZonesModule).includes(TableMapIdentityModule));
});
