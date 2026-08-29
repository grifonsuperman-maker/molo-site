require('reflect-metadata');

const assert = require('node:assert/strict');
const test = require('node:test');

const { ZonesService } = require('../dist/zones/zones.service.js');

function readOnlyHarness() {
  const calls = {
    zoneFind: [],
    zoneWrites: 0,
    restaurantReads: 0,
    restaurantWrites: 0,
    tableReads: 0,
    tableWrites: 0,
  };

  const rows = [
    {
      id: 'zone-hall',
      name: 'Зал ресторану',
      tables: [{ id: 'table-8', tableNumber: '8' }],
    },
  ];

  const zones = {
    async find(options) {
      calls.zoneFind.push(options);
      return rows;
    },
    create() {
      calls.zoneWrites += 1;
      throw new Error('findAll must not create zones');
    },
    async save() {
      calls.zoneWrites += 1;
      throw new Error('findAll must not save zones');
    },
    async remove() {
      calls.zoneWrites += 1;
      throw new Error('findAll must not remove zones');
    },
  };

  const restaurants = {
    async find() {
      calls.restaurantReads += 1;
      throw new Error('findAll must not bootstrap restaurant data');
    },
    create() {
      calls.restaurantWrites += 1;
      throw new Error('findAll must not create restaurant data');
    },
    async save() {
      calls.restaurantWrites += 1;
      throw new Error('findAll must not save restaurant data');
    },
  };

  const tables = {
    async find() {
      calls.tableReads += 1;
      throw new Error('findAll must not bootstrap table data');
    },
    create() {
      calls.tableWrites += 1;
      throw new Error('findAll must not create table data');
    },
    async save() {
      calls.tableWrites += 1;
      throw new Error('findAll must not save table data');
    },
  };

  return {
    calls,
    rows,
    service: new ZonesService(zones, restaurants, tables),
  };
}

test('public zones listing reads existing zones without bootstrap writes', async () => {
  const { calls, rows, service } = readOnlyHarness();

  const result = await service.findAll();

  assert.equal(result, rows);
  assert.deepEqual(calls.zoneFind, [
    {
      relations: ['tables'],
      order: { createdAt: 'ASC' },
    },
  ]);
  assert.equal(calls.zoneWrites, 0);
  assert.equal(calls.restaurantReads, 0);
  assert.equal(calls.restaurantWrites, 0);
  assert.equal(calls.tableReads, 0);
  assert.equal(calls.tableWrites, 0);
});

test('module startup still performs the default-location bootstrap', async () => {
  const service = new ZonesService({}, {}, {});
  let bootstrapCalls = 0;

  service.ensureDefaultLocations = async () => {
    bootstrapCalls += 1;
    return [];
  };

  await service.onModuleInit();

  assert.equal(bootstrapCalls, 1);
});
