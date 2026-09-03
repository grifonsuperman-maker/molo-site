require('reflect-metadata');

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { MapModule } = require('../dist/map/map.module.js');
const { MapService } = require('../dist/map/map.service.js');
const { RestaurantModule } = require('../dist/restaurant/restaurant.module.js');

function createHarness() {
  const calls = {
    restaurants: 0,
    tables: 0,
    zones: 0,
    objects: 0,
  };
  const restaurant = {
    id: 'restaurant-molo',
    name: 'MOLO',
    status: 'open',
    phone: null,
    menuUrl: '/menu',
    logoUrl: '/logo.png',
    mainPhotoUrl: '/logo.png',
    closeMessage: 'closed',
    bookingClosedMessage: 'booking closed',
    mapWidth: 1600,
    mapHeight: 1000,
  };
  const tables = {
    async find() {
      calls.tables += 1;
      return [];
    },
  };
  const zones = {
    async find() {
      calls.zones += 1;
      return [];
    },
  };
  const restaurantService = {
    async getRestaurant() {
      calls.restaurants += 1;
      return restaurant;
    },
  };
  const objects = {
    async find() {
      calls.objects += 1;
      return [];
    },
  };

  return {
    calls,
    restaurant,
    service: new MapService(tables, zones, restaurantService, objects),
  };
}

test('MapModule imports RestaurantModule for the shared restaurant service', () => {
  const imports = Reflect.getMetadata('imports', MapModule) || [];

  assert.equal(imports.includes(RestaurantModule), true);
});

test('full and public maps read restaurant data through RestaurantService', async () => {
  const { calls, restaurant, service } = createHarness();

  const fullMap = await service.getFullMap();
  const publicMap = await service.getPublicMap();

  assert.equal(calls.restaurants, 2);
  assert.equal(fullMap.restaurant, restaurant);
  assert.equal(publicMap.restaurant.id, restaurant.id);
  assert.equal(publicMap.restaurant.mapWidth, 1600);
  assert.equal(publicMap.restaurant.mapHeight, 1000);
  assert.equal(calls.zones, 2);
  assert.equal(calls.tables, 2);
  assert.equal(calls.objects, 2);
});

test('MapService no longer owns a second restaurant bootstrap', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../src/map/map.service.ts'),
    'utf8',
  );

  assert.doesNotMatch(source, /InjectRepository\(Restaurant\)/);
  assert.doesNotMatch(source, /mapWidth:\s*2200/);
  assert.doesNotMatch(source, /mapHeight:\s*1500/);
  assert.match(source, /restaurantService\.getRestaurant\(\)/);
});
