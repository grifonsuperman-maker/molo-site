import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { assertFreshSchemaReferenceTarget } from './fresh-schema-reference.mjs';

export async function runTableMapIdentityValidation(env = process.env) {
  assertFreshSchemaReferenceTarget(env);
  if (env !== process.env) throw new Error('Identity validation must use process.env after safety validation.');
  const require = createRequire(import.meta.url);
  const { DataSource, In } = require('typeorm');
  const { TableMapIdentityService } = require('../dist/tables/table-map-identity.service.js');
  const { TablesService } = require('../dist/tables/tables.service.js');
  const { MapService } = require('../dist/map/map.service.js');
  const { TableEntity } = require('../dist/tables/entities/table.entity.js');
  const { Zone } = require('../dist/zones/entities/zone.entity.js');
  const { Booking } = require('../dist/bookings/entities/booking.entity.js');
  const { MapObject } = require('../dist/map/entities/map-object.entity.js');
  const { CreateTableMapIdentities2026093000030: Migration } = require('../dist/migrations/2026093000030-CreateTableMapIdentities.js');
  const schemaName = 'molo_map_probe_' + randomUUID().replaceAll('-', '');
  const schema = '"' + schemaName + '"';
  const db = new DataSource({
    type: 'postgres', host: env.DB_HOST, port: Number(env.DB_PORT || 5432),
    username: env.DB_USER || 'postgres', password: env.DB_PASSWORD || 'postgres', database: env.DB_NAME,
    schema: schemaName,
    entities: [fileURLToPath(new URL('../dist/**/*.entity.js', import.meta.url))],
    synchronize: false,
  });
  await db.initialize();
  const ids = Array.from({ length: 6 }, () => randomUUID());
  const migration = new Migration();
  const identities = new TableMapIdentityService(db);
  const physicalRows = () => db.query('SELECT * FROM ' + schema + '."tables" WHERE "id"=ANY($1::uuid[]) ORDER BY "id"', [ids]);
  const publicSnapshot = async () => ({
    tables: await db.query('SELECT * FROM public."tables" ORDER BY "id"'),
    bindings: await db.query('SELECT * FROM public."table_map_identities" ORDER BY "table_id"'),
  });
  const columns = () => db.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_schema=$1 AND table_name='tables' ORDER BY ordinal_position", [schemaName]);
  const inMigration = (direction) => db.transaction(async (manager) => migration[direction](manager.queryRunner));
  async function rejects(sql, parameters, code, constraint) {
    await assert.rejects(db.transaction((manager) => manager.query(sql, parameters)),
      (error) => error.code === code && (!constraint || error.constraint === constraint));
  }
  let schemaCreated = false;
  try {
    const baseline = await publicSnapshot();
    assert.equal(baseline.bindings.length, 60, 'Real ZonesService bootstrap must seed the verified physical slots.');
    await assert.rejects(new Migration().down({ isTransactionActive: false }), /requires an active transaction/);
    // A separate namespace keeps every seeded public table/binding untouched.
    await db.query('CREATE SCHEMA ' + schema);
    schemaCreated = true;
    for (const table of ['tables', 'zones', 'map_objects']) {
      await db.query('CREATE TABLE ' + schema + '."' + table + '" (LIKE public."' + table + '" INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)');
    }
    const columnsBefore = await columns();
    await db.query(
      'INSERT INTO ' + schema + '."tables" ("id","table_number","status","x","y","width","height","rotation","photo_url") SELECT id, number, \'cleaning\', 27, 91, 170, 90, 13, \'/existing-test-photo.jpg\' FROM unnest($1::uuid[], $2::text[]) AS fixture(id, number)',
      [ids, ['12', '14', '77', '012', '3', '4']],
    );
    const before = await physicalRows();
    const legacy = await identities.project(await db.getRepository(TableEntity).find({ where: { id: In(ids) } }));
    assert.equal(legacy.prepared, false);
    assert.ok(legacy.tables.every((table) => !Object.hasOwn(table, 'mapKey')));
    await inMigration('up');
    assert.deepEqual(await physicalRows(), before, 'Migration must preserve every original physical field.');
    assert.deepEqual(await columns(), columnsBefore, 'Existing tables schema must stay unchanged.');
    const saved = await db.query('SELECT "table_id","map_key" FROM ' + schema + '."table_map_identities" ORDER BY "map_key"');
    assert.deepEqual(saved.map((row) => row.map_key), ['hall:14', 'hall:3', 'hall:4']);
    assert.ok(!saved.some((row) => [ids[0], ids[2], ids[3]].includes(row.table_id)));
    const diagnostic = await identities.diagnostics();
    assert.deepEqual(diagnostic.summary, { physicalTables: 6, bound: 3, unbound: 3, numberConflicts: 1 });
    assert.equal(diagnostic.mapConsumersReady, false);
    assert.equal(diagnostic.syncEnabled, false);

    const tablesService = new TablesService(db.getRepository(TableEntity), db.getRepository(Zone),
      db.getRepository(Booking), identities);
    assert.equal((await tablesService.findAll()).find((table) => table.id === ids[1]).mapKey, 'hall:14');
    const maps = new MapService(db.getRepository(TableEntity), db.getRepository(Zone),
      { getRestaurant: async () => ({ id: 'test-restaurant', status: 'open' }) }, db.getRepository(MapObject), identities);
    for (const map of [await maps.getFullMap(), await maps.getPublicMap()]) {
      assert.equal(map.mapIdentityPrepared, true);
      assert.equal(map.tables.find((table) => table.id === ids[1]).mapKey, 'hall:14');
    }
    const bindingTable = schema + '."table_map_identities"';
    await rejects('INSERT INTO ' + bindingTable + ' ("table_id","map_key") VALUES ($1,$2)',
      [randomUUID(), 'hall:5'], '23503', 'FK_table_map_identities_table');
    await rejects('INSERT INTO ' + bindingTable + ' ("table_id","map_key") VALUES ($1,$2)',
      [ids[2], 'hall:77'], '23514', 'CHK_table_map_identities_map_key');
    await rejects('INSERT INTO ' + bindingTable + ' ("table_id","map_key") VALUES ($1,$2)',
      [ids[1], 'hall:5'], '23505', 'PK_table_map_identities');
    await rejects('UPDATE ' + bindingTable + ' SET "map_key"=$2 WHERE "table_id"=$1',
      [ids[1], 'canopy:15'], '23514', 'CHK_table_map_identity_immutable');
    await rejects('UPDATE ' + bindingTable + ' SET "table_id"=$2 WHERE "table_id"=$1',
      [ids[1], ids[2]], '23514', 'CHK_table_map_identity_immutable');

    // Unchanged associations can be reconstructed exactly on a safe down/up.
    await inMigration('down');
    assert.equal((await identities.project([])).prepared, false);
    await inMigration('up');
    assert.deepEqual(await db.query('SELECT "table_id","map_key" FROM ' + bindingTable + ' ORDER BY "map_key"'), saved);

    // Synthetic future rename proves storage independence; no rename feature is enabled.
    await db.query('UPDATE ' + schema + '."tables" SET "table_number"=$2 WHERE "id"=$1', [ids[1], '99']);
    for (const row of await physicalRows()) {
      const original = before.find((item) => item.id === row.id);
      assert.deepEqual({ ...row, table_number: original.table_number }, original);
    }
    const renamed = (await tablesService.findAll()).find((table) => table.id === ids[1]);
    assert.equal(renamed.tableNumber, '99');
    assert.equal(renamed.mapKey, 'hall:14');
    assert.equal(renamed.mapLocation, 'hall');
    assert.equal(renamed.status, 'cleaning');
    await assert.rejects(inMigration('down'), /non-reconstructable binding records exist/);

    const outcomes = await Promise.allSettled([ids[0], ids[3]].map((id) =>
      db.transaction((manager) => manager.query(
        'INSERT INTO ' + bindingTable + ' ("table_id","map_key") VALUES ($1,$2)', [id, 'hall:5'],
      ))));
    assert.equal(outcomes.filter((result) => result.status === 'fulfilled').length, 1);
    const loser = outcomes.find((result) => result.status === 'rejected');
    assert.equal(loser.reason.code, '23505');
    assert.equal(loser.reason.constraint, 'UQ_table_map_identities_map_key');
    await db.query('DELETE FROM ' + schema + '."tables" WHERE "id"=$1', [ids[1]]);
    assert.equal((await db.query('SELECT count(*)::int AS count FROM ' + bindingTable + ' WHERE "table_id"=$1', [ids[1]]))[0].count, 0);
    await db.query('DELETE FROM ' + schema + '."tables" WHERE "id"=ANY($1::uuid[])', [ids]);
    await inMigration('down');
    await inMigration('up');
    assert.deepEqual(await columns(), columnsBefore);
    assert.equal((await db.query('SELECT count(*)::int AS count FROM ' + bindingTable))[0].count, 0);
    assert.deepEqual(await publicSnapshot(), baseline, 'All real seeded physical tables/bindings must remain untouched.');
  } finally {
    try {
      if (schemaCreated) await db.query('DROP SCHEMA ' + schema + ' CASCADE');
    } finally {
      await db.destroy();
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runTableMapIdentityValidation().then(() => {
    process.stdout.write('Physical map identity PostgreSQL validation passed.\n');
  }).catch((error) => {
    console.error('Physical map identity validation failed: ' + (error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  });
}
