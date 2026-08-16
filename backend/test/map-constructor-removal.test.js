require('reflect-metadata');

const assert = require('node:assert/strict');
const test = require('node:test');

const { MapModule } = require('../dist/map/map.module.js');
const mapControllerExports = require('../dist/map/map.controller.js');

const { MapController } = mapControllerExports;

test('MapModule keeps only the active map controller', () => {
  const controllers = Reflect.getMetadata('controllers', MapModule);

  assert.deepEqual(controllers, [MapController]);
});

test('legacy Constructor compatibility controller is no longer exported', () => {
  assert.equal(mapControllerExports.LegacyMapCompatibilityController, undefined);
});
