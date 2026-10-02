import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertFreshSchemaReferenceTarget } from './fresh-schema-reference.mjs';

export async function runSyrveStatusProjectionValidation(env = process.env) {
  assertFreshSchemaReferenceTarget(env);
  if (env !== process.env) throw new Error('Status validation must use process.env after safety validation.');
  const require = createRequire(import.meta.url);
  const { DataSource } = require('typeorm');
  const { TableEntity } = require('../dist/tables/entities/table.entity.js');
  const { Zone } = require('../dist/zones/entities/zone.entity.js');
  const { Booking } = require('../dist/bookings/entities/booking.entity.js');
  const { MapObject } = require('../dist/map/entities/map-object.entity.js');
  const { TablesService } = require('../dist/tables/tables.service.js');
  const { MapService } = require('../dist/map/map.service.js');
  const { BookingsService } = require('../dist/bookings/bookings.service.js');
  const { TableMapIdentityService } = require('../dist/tables/table-map-identity.service.js');
  const { TableStatusProjectionService } = require('../dist/tables/table-status-projection.service.js');
  const { SyrveSettingsStore } = require('../dist/syrve/syrve-settings.store.js');
  const { SyrveStateStore } = require('../dist/syrve/syrve-state.store.js');
  const { SyrveStatusReadStore } = require('../dist/syrve/syrve-status-read.store.js');
  const { SyrveStatusReadService } = require('../dist/syrve/syrve-status-read.service.js');
  const { SyrveStaffActionsService } = require('../dist/syrve/syrve-staff-actions.service.js');
  const { id, row, probe, batches } = require('../test/helpers/syrve-state-fixtures.js');
  const options = { type: 'postgres', host: env.DB_HOST, port: Number(env.DB_PORT || 5432),
    username: env.DB_USER || 'postgres', password: env.DB_PASSWORD || 'postgres', database: env.DB_NAME,
    synchronize: false, entities: [fileURLToPath(new URL('../dist/**/*.entity.js', import.meta.url))],
    extra: { connectionTimeoutMillis: 5000, statement_timeout: 10000 } };
  let source = new DataSource(options); await source.initialize();
  const tableId = randomUUID(), zoneId = randomUUID(), organizationId = randomUUID(), providerId = randomUUID();
  const number = String(5_000_000 + Math.floor(Math.random() * 1_000_000));
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' }).format(new Date()), future = '2099-10-02';
  let integrationId, linkId;
  const states = () => new SyrveStateStore(source, new SyrveSettingsStore(source));
  const reader = () => new SyrveStatusReadStore(source, new SyrveSettingsStore(source));
  // Synthetic dependency injection, never a production activation path.
  const prepared = () => new TableStatusProjectionService({ snapshot: (ids) => reader().read(ids) });
  const disabled = () => new TableStatusProjectionService({snapshot:async()=>({syncEnabled:false,tables:new Map()})});
  const services = (projection) => {
    const tables = source.getRepository(TableEntity), zones = source.getRepository(Zone), bookings = source.getRepository(Booking);
    const identities = new TableMapIdentityService(source), staff = new SyrveStaffActionsService(source, new SyrveSettingsStore(source));
    return { tables: new TablesService(tables, zones, bookings, identities, staff, projection),
      maps: new MapService(tables, zones, { getRestaurant: async () => ({ id: 'ci', status: 'open' }) }, source.getRepository(MapObject), identities, projection),
      bookings: new BookingsService(bookings, {}, {}, {}, tables, {}, {}, {}, {}, projection) };
  };
  const saved = async () => {
    const result = {};
    for (const [name, order] of [['tables', 'id'], ['zones', 'id'], ['bookings', 'id'], ['syrve_integrations', 'id'],
      ['syrve_table_links', 'id'], ['syrve_table_sync_states', 'link_id'], ['syrve_order_versions', 'link_id,order_id']]) {
      result[name] = await source.query(`SELECT * FROM "${name}" ORDER BY ${order}`);
    }
    return result;
  };
  const readRoles = async (projection, date = today) => {
    const before = await saved(), s = services(projection);
    const waiter = (await s.tables.findAll()).find((value) => value.id === tableId);
    const full = await s.maps.getFullMap(), publicMap = await s.maps.getPublicMap();
    const window = await s.bookings.getTableStatuses({ bookingDate: date, bookingTime: '19:00', durationMinutes: 60 });
    assert.deepEqual(await saved(), before, 'Role reads must never write/rebase/repair any source.');
    const rows = [waiter, full.tables.find((value) => value.id === tableId), publicMap.tables.find((value) => value.id === tableId),
      full.zones.find((value) => value.id === zoneId).tables[0], publicMap.zones.find((value) => value.id === zoneId).tables[0]];
    for (const value of rows) {
      assert.equal(value.id, tableId); assert.equal(value.tableNumber, number);
      assert.equal(Number(value.x), 17); assert.equal(Number(value.rotation), 45); assert.equal(value.photoUrl, '/existing-status-ci.jpg');
      assert.doesNotMatch(JSON.stringify(value), /orderVersions|activeSyrve|manuallyFreed|configurationRevision|apiLogin|accessToken/);
    }
    return { rows, window: window.statuses[number] };
  };
  const expectToday = async (projection, physicalStatus, windowStatus = physicalStatus) => {
    const value = await readRoles(projection);
    assert.ok(value.rows.every((row) => row.status === physicalStatus)); assert.equal(value.window.status, windowStatus);
  };
  const observe = async (rows) => {
    const captured = await states().capture(tableId), parts = batches(captured, rows);
    parts[0].probe.byTable = probe(captured.state.scope, rows).byTable;
    return states().applyObservation(captured, parts);
  };
  try {
    assert.equal(Number((await source.query('SELECT count(*) AS count FROM "syrve_integrations"'))[0].count), 0);
    await source.query('INSERT INTO "zones" (id,name,is_visible,is_closed) VALUES ($1,\'Synthetic status CI\',true,false)', [zoneId]);
    await source.query('INSERT INTO "tables" (id,zone_id,table_number,status,x,rotation,photo_url) VALUES ($1,$2,$3,\'free\',17,45,\'/existing-status-ci.jpg\')', [tableId, zoneId, number]);
    integrationId = (await source.query('INSERT INTO "syrve_integrations" (display_name,organization_id,status,api_login_encrypted,api_login_iv,api_login_auth_tag) VALUES (\'Synthetic status CI\',$1,\'connected\',\'synthetic\',\'synthetic\',\'synthetic\') RETURNING id', [organizationId]))[0].id;
    linkId = (await source.query('INSERT INTO "syrve_table_links" (integration_id,organization_id,molo_table_id,syrve_table_id,last_known_number) VALUES ($1,$2,$3,$4,1) RETURNING id', [integrationId, organizationId, tableId, providerId]))[0].id;
    assert.equal((await new SyrveStatusReadService(source).snapshot([tableId])).syncEnabled,false);
    const {consentDatabase}=require('../test/helpers/syrve-confirmed-worker.js');
    await consentDatabase(source,new SyrveSettingsStore(source));
    await expectToday(prepared(), 'free');
    assert.equal(Number((await source.query('SELECT count(*) AS count FROM "syrve_table_sync_states" WHERE link_id=$1', [linkId]))[0].count), 0);
    const first = await states().capture(tableId);
    await observe([row(first.state.scope, id(10))]);
    await expectToday(disabled(), 'free'); await expectToday(prepared(), 'occupied');
    const nextDate = await readRoles(prepared(), future);
    assert.ok(nextDate.rows.every((value) => value.status === 'occupied')); assert.equal(nextDate.window.status, 'free');

    // PostgreSQL enforces read-only, even if an accidental write were added.
    let verifiedReadOnly = false;
    const guardedSource = { options: source.options, transaction: (isolation, action) => source.transaction(isolation, async (manager) => {
      const query = manager.query.bind(manager);
      manager.query = async (sql, args) => {
        const result = await query(sql, args);
        if (sql.startsWith('SET LOCAL statement_timeout')) {
          assert.equal((await query('SHOW transaction_read_only'))[0].transaction_read_only, 'on');
          assert.equal((await query('SHOW transaction_isolation'))[0].transaction_isolation, 'repeatable read');
          await query('SAVEPOINT read_probe');
          await assert.rejects(query('UPDATE "tables" SET status=status WHERE id=$1', [tableId]), error => error.code === '25006');
          await query('ROLLBACK TO SAVEPOINT read_probe'); await query('RELEASE SAVEPOINT read_probe'); verifiedReadOnly = true;
        }
        return result;
      };
      return action(manager);
    }) };
    const beforeReadOnly = await saved();
    await new SyrveStatusReadStore(guardedSource, new SyrveSettingsStore(source)).read([tableId]);
    assert.equal(verifiedReadOnly, true); assert.deepEqual(await saved(), beforeReadOnly);

    // Change only the real zone row between the map's independent queries.
    // Table status/timestamp stay identical, reproducing the reviewed race.
    const physicalBeforeRace = await source.query('SELECT * FROM "tables" WHERE id=$1', [tableId]);
    const stateBeforeRace = await saved(); delete stateBeforeRace.zones;
    const zoneRepository = source.getRepository(Zone), tableRepository = source.getRepository(TableEntity);
    for (const method of ['getFullMap', 'getPublicMap']) {
      for (const [flag, from, to] of [['isClosed', false, true], ['isClosed', true, false],
        ['isVisible', true, false], ['isVisible', false, true]]) {
        await zoneRepository.update(zoneId, { isVisible: true, isClosed: false, [flag]: from });
        const change = () => zoneRepository.update(zoneId, { [flag]: to });
        const tables = method === 'getFullMap' ? { find: async (options) => {
          const values = await tableRepository.find(options); await change(); return values;
        } } : tableRepository;
        const zones = method === 'getPublicMap' ? { find: async (options) => {
          const values = await zoneRepository.find(options); await change(); return values;
        } } : zoneRepository;
        const maps = new MapService(tables, zones, { getRestaurant: async () => ({ id: 'ci', status: 'open' }) },
          source.getRepository(MapObject), new TableMapIdentityService(source), prepared());
        const value = await maps[method]();
        const flat = value.tables.find((row) => row.id === tableId), parent = value.zones.find((row) => row.id === zoneId);
        if (method === 'getPublicMap' && flag === 'isVisible' && !from) {
          assert.equal(flat, undefined); assert.equal(parent, undefined);
        } else {
          assert.equal(flat.status, 'free', `${method}/${flag}/${from}: flat`);
          assert.equal(parent.tables.find((row) => row.id === tableId).status, 'free', `${method}/${flag}/${from}: nested`);
        }
        assert.deepEqual(await source.query('SELECT * FROM "tables" WHERE id=$1', [tableId]), physicalBeforeRace);
      }
    }
    await zoneRepository.update(zoneId, { isVisible: true, isClosed: false });
    const stateAfterRace = await saved(); delete stateAfterRace.zones;
    assert.deepEqual(stateAfterRace, stateBeforeRace);

    // Actual waiter free keeps an approved booking and suppresses old POS IDs.
    await source.query('INSERT INTO "bookings" (table_id,booking_date,booking_time,guests_count,status,source,duration_minutes) VALUES ($1,$2,\'19:00\',2,\'approved\',\'admin_manual\',60)', [tableId, today]);
    assert.equal((await services(disabled()).tables.setWaiterStatus(tableId, 'free')).status, 'reserved');
    await expectToday(prepared(), 'reserved');
    await observe([row(first.state.scope, id(10), 'New', 101)]); await expectToday(prepared(), 'reserved');
    await source.destroy(); source = new DataSource(options); await source.initialize();
    await expectToday(prepared(), 'reserved');
    await observe([row(first.state.scope, id(10), 'New', 102), row(first.state.scope, id(11), 'New', 102)]);
    await expectToday(prepared(), 'occupied');
    await services(disabled()).tables.close(tableId); await expectToday(prepared(), 'closed');
    await services(disabled()).tables.open(tableId); await expectToday(prepared(), 'free', 'reserved');

    // Trusted synthetic closure/tombstones are setup only, not a proof setter.
    await source.query('UPDATE "syrve_table_links" SET last_syrve_state=\'closed\',active_syrve_order_ids=\'{}\',manually_freed_syrve_order_ids=\'{}\' WHERE id=$1', [linkId]);
    await source.query('UPDATE "syrve_order_versions" SET state=\'closed\',timestamp=300 WHERE link_id=$1', [linkId]);
    const tombstones = Array.from({ length: 4201 }, (_, index) => id(1000 + index));
    await source.query('INSERT INTO "syrve_order_versions" (link_id,order_id,timestamp,state,fingerprint) SELECT $1,id,300,\'closed\',$3 FROM unnest($2::uuid[]) AS value(id)', [linkId, tombstones, 'b'.repeat(64)]);
    assert.equal((await reader().read([tableId])).tables.get(tableId).state.orderVersions.length, 4203);
    await services(disabled()).tables.markOccupied(tableId); await expectToday(prepared(), 'occupied');
    await services(disabled()).tables.markCleaning(tableId); await expectToday(prepared(), 'cleaning');

    await source.query('UPDATE "syrve_integrations" SET configuration_revision=uuid_generate_v4() WHERE id=$1', [integrationId]);
    const changed = await saved(); assert.equal((await reader().read([tableId])).tables.size, 0); assert.deepEqual(await saved(), changed);
    await services(disabled()).tables.markFree(tableId); // explicit staff action adopts the revision
    await consentDatabase(source,new SyrveSettingsStore(source));
    const captured = await states().capture(tableId); await observe([row(captured.state.scope, id(12), 'New', 400)]);
    const originalVersion = (await source.query('SELECT * FROM "syrve_order_versions" WHERE link_id=$1 AND order_id=$2', [linkId, id(12)]))[0];
    await source.query('DELETE FROM "syrve_order_versions" WHERE link_id=$1 AND order_id=$2', [linkId, id(12)]);
    const corrupt = await saved(); await assert.rejects(reader().read([tableId]), error => error.getStatus() === 503);
    await expectToday(disabled(), 'free', 'reserved');
    const futureOnly = await services(prepared()).bookings.getTableStatuses({ bookingDate: future, bookingTime: '19:00' });
    assert.equal(futureOnly.statuses[number].status, 'free'); assert.deepEqual(await saved(), corrupt);
    await source.query('INSERT INTO "syrve_order_versions" (link_id,order_id,timestamp,state,fingerprint) VALUES ($1,$2,$3,$4,$5)', [linkId, originalVersion.order_id, originalVersion.timestamp, originalVersion.state, originalVersion.fingerprint]);
    await source.query('UPDATE "syrve_integrations" SET status=\'disconnected\' WHERE id=$1', [integrationId]);
    await expectToday(prepared(), 'free', 'reserved');
  } finally {
    try {
      if (integrationId) await source.query('DELETE FROM "syrve_integrations" WHERE id=$1', [integrationId]);
      await source.query('DELETE FROM "bookings" WHERE table_id=$1', [tableId]);
      await source.query('DELETE FROM "tables" WHERE id=$1', [tableId]); await source.query('DELETE FROM "zones" WHERE id=$1', [zoneId]);
    } finally { await source.destroy(); }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSyrveStatusProjectionValidation().then(() => process.stdout.write('Syrve unified status PostgreSQL validation passed.\n'))
    .catch(error => { console.error(`Syrve status validation failed: ${error.message}`); process.exitCode = 1; });
}
