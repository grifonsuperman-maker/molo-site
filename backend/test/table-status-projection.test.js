require('reflect-metadata');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const test = require('node:test');
const { Test } = require('@nestjs/testing');
const { DataSource } = require('typeorm');
const { TableStatusProjectionService } = require('../dist/tables/table-status-projection.service.js');
const { TableStatusProjectionModule } = require('../dist/tables/table-status-projection.module.js');
const { SyrveStatusReadService } = require('../dist/syrve/syrve-status-read.service.js');
const { SyrveStatusReadStore, disabledSyrveStatus } = require('../dist/syrve/syrve-status-read.store.js');
const { TablesService } = require('../dist/tables/tables.service.js');
const { MapService } = require('../dist/map/map.service.js');
const { BookingsService } = require('../dist/bookings/bookings.service.js');
const { AvailabilityBlocksService } = require('../dist/bookings/availability-blocks.service.js');
const { createSyrveTableSyncState, reduceSyrveStaffAction } = require('../dist/syrve/syrve-state-reducer.js');
const { disabledTableStatuses } = require('./helpers/disabled-table-statuses.js');
const { id } = require('./helpers/syrve-state-fixtures.js');

const TODAY = '2026-10-01', FUTURE = '2026-10-02';
function table(status = 'free') {
  return { id: id(100), tableNumber: '12', status, isVisible: true, updatedAt: new Date('2026-10-01T10:00:00Z'),
    zone: { id: id(101), isVisible: true, isClosed: false }, seats: 4, x: 17, y: 91, rotation: 45, photoUrl: '/existing.jpg' };
}
function state(physical, active = [id(10)], freed = []) {
  const scope = { integrationId: id(1), configurationRevision: id(2), organizationId: id(3),
    moloTableId: physical.id, syrveTableId: id(4) };
  return { ...createSyrveTableSyncState(scope, id(5)), lastSyrveState: active.length ? 'open' : 'closed',
    activeSyrveOrderIds: active, manuallyFreedSyrveOrderIds: freed,
    orderVersions: active.map((orderId) => ({ id: orderId, timestamp: 100, state: 'open', fingerprint: 'a'.repeat(64) })) };
}
function snapshot(physical, saved = state(physical)) {
  return { syncEnabled: true, tables: new Map([[physical.id, { state: saved, currentScope: saved.scope,
    physicalStatus: physical.status, physicalUpdatedAt: physical.updatedAt.getTime() }]]) };
}
function cohort(physical, projection, activeBookings = [], mapZone = physical.zone) {
  const tables = { find: async () => [structuredClone(physical)] };
  const nested = { ...structuredClone(physical) }; delete nested.zone;
  const zones = { find: async () => [{ ...mapZone, tables: [nested] }] };
  const identities = { project: async (values) => ({ prepared: true, tables: values.map((value) => ({ ...value, mapKey: 'hall:12' })) }) };
  const waiter = new TablesService(tables, zones, {}, identities, undefined, projection);
  const maps = new MapService(tables, zones, { getRestaurant: async () => ({ id: 'restaurant', status: 'open' }) },
    { find: async () => [] }, identities, projection);
  const bookings = { createQueryBuilder: () => {
    const query = { leftJoinAndSelect: () => query, where: () => query, andWhere: () => query,
      orderBy: () => query, getMany: async () => structuredClone(activeBookings) };
    return query;
  } };
  const bookingService = new BookingsService(bookings, {}, {}, {}, tables, {}, {}, {}, {}, projection);
  bookingService.restaurantDateToday = () => TODAY;
  return { waiter, maps, bookings: bookingService };
}
async function roleStatuses(services, date = TODAY) {
  const waiter = (await services.waiter.findAll())[0];
  const full = await services.maps.getFullMap(), guest = await services.maps.getPublicMap();
  const window = await services.bookings.getTableStatuses({ bookingDate: date, bookingTime: '19:00' });
  return { waiter, full, guest, window };
}

test('the production read gate stays off without prepared storage even with an environment flag', async () => {
  const before = process.env.SYRVE_SYNC_ENABLED; process.env.SYRVE_SYNC_ENABLED = 'true';
  try {
    const source = new SyrveStatusReadService(require('./helpers/disabled-table-statuses.js').disabledSource());
    for (const ids of [[], [id(100)], [id(100), id(101)]]) {
      assert.deepEqual(await source.snapshot(ids), disabledSyrveStatus());
    }
  } finally {
    if (before === undefined) delete process.env.SYRVE_SYNC_ENABLED; else process.env.SYRVE_SYNC_ENABLED = before;
  }
});

test('real Nest projection module resolves the shared engine with a DataSource and no integration module', async () => {
  // The global TypeORM provider is supplied by AppModule in production.
  const { Module, Global } = require('@nestjs/common');
  class Database {}
  Global()(Database); Module({ providers: [{ provide: DataSource, useValue: require('./helpers/disabled-table-statuses.js').disabledSource() }], exports: [DataSource] })(Database);
  const actual = await Test.createTestingModule({ imports: [Database, TableStatusProjectionModule] }).compile();
  try {
    assert.deepEqual(await actual.get(TableStatusProjectionService).capture([table()]), disabledSyrveStatus());
    for (const [path, name] of [['tables/tables', 'Tables'], ['map/map', 'Map'], ['bookings/bookings', 'Bookings']]) {
      const module = require(`../dist/${path}.module.js`)[`${name}Module`];
      assert.ok(Reflect.getMetadata('imports', module).includes(TableStatusProjectionModule));
    }
  } finally { await actual.close(); }
});

test('disabled booking-window projection preserves the full legacy priority matrix for today and future', async () => {
  const projection = disabledTableStatuses(), disabled = await projection.capture([table()]);
  for (const date of [TODAY, FUTURE]) for (const manual of ['free', 'pending', 'reserved', 'occupied', 'cleaning', 'closed']) {
    for (const conflict of [null, 'pending', 'approved']) for (const visibility of ['visible', 'hidden', 'zone_hidden', 'zone_closed']) {
      const physical = table(manual);
      if (visibility === 'hidden') physical.isVisible = false;
      if (visibility === 'zone_hidden') physical.zone.isVisible = false;
      if (visibility === 'zone_closed') physical.zone.isClosed = true;
      const expected = visibility === 'hidden' || visibility === 'zone_hidden' ? ['closed', 'hidden']
        : manual === 'closed' || visibility === 'zone_closed' ? ['closed', 'closed']
          : date === TODAY && ['occupied', 'cleaning'].includes(manual) ? [manual, 'physical_status_today']
            : conflict ? [conflict === 'approved' ? 'reserved' : 'pending', 'booking_conflict'] : ['free', null];
      assert.deepEqual(projection.window(physical, disabled, { bookingDate: date, today: TODAY, conflict }),
        { status: expected[0], reason: expected[1] }, `${date}/${manual}/${conflict}/${visibility}`);
    }
  }
});

test('disabled flat and nested maps preserve status, UUID, geometry, identity and visibility contracts', async () => {
  for (const manual of ['free', 'pending', 'reserved', 'occupied', 'cleaning', 'closed']) {
    const physical = table(manual), before = structuredClone(physical);
    const result = await roleStatuses(cohort(physical, disabledTableStatuses()));
    for (const value of [result.waiter, result.full.tables[0], result.guest.tables[0]]) {
      assert.deepEqual(value, { ...physical, mapKey: 'hall:12' });
    }
    assert.equal(result.full.zones[0].tables[0].status, manual);
    assert.equal(result.guest.zones[0].tables[0].status, manual);
    assert.deepEqual(physical, before);
  }
});

test('one saved POS snapshot contributes occupied across waiter, director, admin and guest reads by physical UUID', async () => {
  const physical = table(), saved = snapshot(physical), before = structuredClone(saved);
  const projection = new TableStatusProjectionService({ snapshot: async () => saved });
  const result = await roleStatuses(cohort(physical, projection));
  for (const value of [result.waiter, result.full.tables[0], result.guest.tables[0],
    result.full.zones[0].tables[0], result.guest.zones[0].tables[0], result.window.statuses['12']]) assert.equal(value.status, 'occupied');
  assert.equal(result.window.statuses['12'].reason, 'physical_status_today');
  assert.deepEqual(saved, before);
  assert.doesNotMatch(JSON.stringify(result), /orderVersions|activeSyrve|manuallyFreed|configurationRevision|syrveTableId|apiLogin|accessToken/);
});

test('manual free suppresses existing orders; a different new order can contribute occupied', () => {
  const physical = table(), original = state(physical);
  const suppressed = reduceSyrveStaffAction(original, { action: 'manual_free', expectedScope: original.scope,
    currentScope: original.scope, expectedRevision: original.localRevision, nextRevision: randomUUID() }).state;
  const projection = new TableStatusProjectionService({});
  assert.equal(projection.physical([physical], snapshot(physical, suppressed))[0].status, 'free');
  const next = state(physical, [id(10), id(11)], [id(10)]);
  assert.equal(projection.physical([physical], snapshot(physical, next))[0].status, 'occupied');
  assert.deepEqual(next.manuallyFreedSyrveOrderIds, [id(10)]);
});

test('removing POS occupancy never clears manual occupied, cleaning or MOLO reservations', () => {
  const projection = new TableStatusProjectionService({});
  for (const manual of ['free', 'occupied', 'cleaning', 'reserved', 'pending', 'closed']) {
    const physical = table(manual);
    for (const saved of [state(physical, []), state(physical, [id(10)], [id(10)])]) {
      assert.equal(projection.physical([physical], snapshot(physical, saved))[0].status, manual);
    }
    const result = projection.window(physical, snapshot(physical, state(physical, [])),
      { bookingDate: TODAY, today: TODAY, conflict: 'approved' });
    assert.equal(result.status, ['occupied', 'cleaning', 'closed'].includes(manual) ? manual : 'reserved');
  }
});

test('hidden/closed tables and zones win over POS occupancy', () => {
  const projection = new TableStatusProjectionService({});
  for (const kind of ['hidden', 'zone_hidden', 'zone_closed', 'table_closed']) {
    const physical = table(kind === 'table_closed' ? 'closed' : 'free');
    if (kind === 'hidden') physical.isVisible = false;
    if (kind === 'zone_hidden') physical.zone.isVisible = false;
    if (kind === 'zone_closed') physical.zone.isClosed = true;
    const value = snapshot(physical);
    assert.equal(projection.physical([physical], value)[0].status, physical.status);
    assert.equal(projection.window(physical, value, { bookingDate: TODAY, today: TODAY, conflict: 'pending' }).status, 'closed');
  }
});

test('future dates skip the source and retain only the selected booking window', async () => {
  const physical = table('occupied'), projection = new TableStatusProjectionService({ snapshot: async () => assert.fail('future source called') });
  const result = await cohort(physical, projection).bookings.getTableStatuses({ bookingDate: FUTURE, bookingTime: '19:00' });
  assert.equal(result.statuses['12'].status, 'free');
  assert.equal(result.statuses['12'].reason, null);
});

test('booking conflict details and the cleanup boundary stay unchanged while today adds POS occupied', async () => {
  const physical = table();
  const booking = { id: id(200), table: physical, status: 'pending', bookingTime: '18:00:00', durationMinutes: 60 };
  for (const enabled of [false, true]) {
    const projection = enabled ? new TableStatusProjectionService({ snapshot: async () => snapshot(physical) }) : disabledTableStatuses();
    const services = cohort(physical, projection, [booking]);
    const result = await services.bookings.getTableStatuses({ bookingDate: TODAY, bookingTime: '19:00', durationMinutes: 60 });
    assert.equal(result.statuses['12'].status, enabled ? 'occupied' : 'pending');
    assert.deepEqual(result.statuses['12'].conflict, { bookingId: booking.id, status: 'pending', tableNumber: '12',
      bookedFrom: '18:00:00', bookedTo: '19:00:00', availableFrom: '19:15:00', bookedFromLabel: '18:00',
      bookedToLabel: '19:00', availableFromLabel: '19:15' });
    assert.equal(result.requestedAvailableFrom, '20:15:00');
    const boundary = await services.bookings.getTableStatuses({ bookingDate: FUTURE, bookingTime: '19:15' });
    assert.equal(boundary.statuses['12'].status, 'free');
    assert.equal(boundary.statuses['12'].conflict, null);
  }
});

test('existing availability blocks still overlay the common status result as closed', async () => {
  const physical = table(), projection = new TableStatusProjectionService({ snapshot: async () => snapshot(physical) });
  const payload = await cohort(physical, projection).bookings.getTableStatuses({ bookingDate: TODAY, bookingTime: '19:00' });
  const block = { id: id(300), table: physical, blockDate: TODAY, startTime: '18:00', endTime: '22:00', reason: 'CI' };
  const blocks = new AvailabilityBlocksService({}, { find: async () => [block] }, {}, {}, { find: async () => [physical] }, {}, {}, {});
  blocks.today = () => TODAY;
  const result = await blocks.applyTableStatuses({ bookingDate: TODAY, bookingTime: '19:00' }, payload);
  assert.equal(result.statuses['12'].status, 'closed');
  assert.equal(result.statuses['12'].reason, 'availability_block');
  assert.equal(result.statuses['12'].conflict, null);
  assert.equal(payload.statuses['12'].status, 'occupied');
});

test('a changed physical frame or mixed flat/nested copies cannot replay POS occupancy', async () => {
  const physical = table(), saved = snapshot(physical), projection = new TableStatusProjectionService({ snapshot: async () => saved });
  const changed = { ...physical, updatedAt: new Date(physical.updatedAt.getTime() + 1) };
  assert.equal(projection.physical([changed], saved)[0].status, 'free');
  const mixed = await projection.capture([physical, changed]);
  assert.equal(mixed.tables.size, 0);
  assert.equal(projection.physical([physical], mixed)[0].status, 'free');
  const restored = { ...physical, status: 'cleaning' };
  assert.equal(projection.physical([restored], saved)[0].status, 'cleaning');
});

test('zone open/close changes between map queries decline POS on both flat and nested copies', async () => {
  for (const [oldClosed, newClosed] of [[false, true], [true, false]]) {
    const physical = table(); physical.zone.isClosed = oldClosed;
    const saved = snapshot(physical), projection = new TableStatusProjectionService({ snapshot: async () => saved });
    const newerZone = { ...physical.zone, isClosed: newClosed };
    const maps = cohort(physical, projection, [], newerZone).maps;
    for (const result of [await maps.getFullMap(), await maps.getPublicMap()]) {
      assert.equal(result.tables[0].status, 'free');
      assert.equal(result.zones[0].tables[0].status, 'free');
      assert.equal(result.tables[0].zone.isClosed, oldClosed);
      assert.equal(result.zones[0].isClosed, newClosed);
      assert.equal(result.tables[0].updatedAt.getTime(), result.zones[0].tables[0].updatedAt.getTime());
    }
    assert.equal(saved.tables.size, 1, 'Capture must not mutate the shared saved state.');
  }
});

test('zone visibility changes between map queries keep public filtering and cannot add inconsistent POS', async () => {
  for (const [oldVisible, newVisible] of [[true, false], [false, true]]) {
    const physical = table(); physical.zone.isVisible = oldVisible;
    const projection = new TableStatusProjectionService({ snapshot: async () => snapshot(physical) });
    const maps = cohort(physical, projection, [], { ...physical.zone, isVisible: newVisible }).maps;
    const full = await maps.getFullMap();
    assert.equal(full.tables[0].status, 'free'); assert.equal(full.zones[0].tables[0].status, 'free');
    const publicMap = await maps.getPublicMap();
    if (newVisible) {
      assert.equal(publicMap.tables[0].status, 'free'); assert.equal(publicMap.zones[0].tables[0].status, 'free');
    } else { assert.deepEqual(publicMap.tables, []); assert.deepEqual(publicMap.zones, []); }
  }
});

test('map consistency checks include zone UUID and table visibility and use the actual nested parent', async () => {
  const physical = table(), saved = snapshot(physical), projection = new TableStatusProjectionService({ snapshot: async () => saved });
  const nested = { ...physical, zone: { ...physical.zone, isClosed: true } };
  const visibleParent = { ...physical.zone, tables: [nested] };
  const consistent = await projection.captureMap([physical], [visibleParent]);
  assert.equal(consistent.tables.size, 1);
  assert.equal(projection.zones([visibleParent], consistent)[0].tables[0].status, 'occupied',
    'Nested projection and capture must use the same authoritative parent context.');
  for (const parent of [{ ...visibleParent, id: id(999) },
    { ...visibleParent, tables: [{ ...nested, isVisible: false }] }]) {
    const mixed = await projection.captureMap([physical], [parent]);
    assert.equal(mixed.tables.size, 0);
    assert.equal(projection.physical([physical], mixed)[0].status, 'free');
    assert.equal(projection.zones([parent], mixed)[0].tables[0].status, 'free');
  }
});

test('foreign scopes and unlinked UUIDs never affect another physical table or create rows', () => {
  const physical = table(), projection = new TableStatusProjectionService({});
  for (const key of ['integrationId', 'configurationRevision', 'organizationId', 'moloTableId', 'syrveTableId']) {
    const saved = snapshot(physical); saved.tables.get(physical.id).currentScope = { ...saved.tables.get(physical.id).currentScope, [key]: randomUUID() };
    assert.equal(projection.physical([physical], saved)[0].status, 'free');
  }
  assert.equal(projection.physical([{ ...physical, id: id(999) }], snapshot(physical))[0].status, 'free');
});

function readerHarness() {
  const physical = table(), saved = state(physical), queries = [];
  const link = { id: id(6), integrationId: saved.scope.integrationId, organizationId: saved.scope.organizationId,
    moloTableId: physical.id, syrveTableId: saved.scope.syrveTableId, lastSyrveState: saved.lastSyrveState,
    activeSyrveOrderIds: [...saved.activeSyrveOrderIds], manuallyFreedSyrveOrderIds: [] };
  const durable = { link_id: link.id, integration_id: saved.scope.integrationId, configuration_revision: saved.scope.configurationRevision,
    organization_id: saved.scope.organizationId, molo_table_id: physical.id, syrve_table_id: saved.scope.syrveTableId, local_revision: saved.localRevision };
  const data = { prepared: true, settings: { prepared: true, entity: { id: saved.scope.integrationId,
    configurationRevision: saved.scope.configurationRevision, organizationId: saved.scope.organizationId, status: 'connected',apiBaseUrl:'https://api-eu.syrve.live',apiLoginEncrypted:'synthetic',apiLoginIv:'synthetic',apiLoginAuthTag:'synthetic' }, links: [link] },
  rows: [durable], versions: saved.orderVersions.map((v) => ({ link_id: link.id, order_id: v.id, ...v })), physical };
  const {activationBindings}=require('../dist/syrve/syrve-activation.js');
  const consent={enabled:true,configuration_revision:saved.scope.configurationRevision,actor_hash:'a'.repeat(64),consented_at:new Date(),
    bindings_fingerprint:activationBindings(data.settings,[physical]),loading_plan:{organizationId:saved.scope.organizationId,
      groups:[{terminalGroupId:id(1),posVersion:'7.7.1',tableIds:[link.syrveTableId]}]}};
  const manager = { query: async (sql) => {
    queries.push(sql);
    if(sql.includes('syrve_sync_activation')&&!sql.includes('to_regclass'))return [structuredClone(consent)];
    assert.doesNotMatch(sql, /FOR UPDATE|INSERT|UPDATE|DELETE|advisory/i);
    if (sql.includes('to_regclass')) return [{ prepared: data.prepared }];
    if (sql.includes('FROM "public"."syrve_table_sync_states"')) return structuredClone(data.rows);
    if (sql.includes('FROM "public"."syrve_order_versions"')) return structuredClone(data.versions);
    assert.match(sql, /^SET /); return [];
  }, getRepository: () => ({ find: async () => [structuredClone(data.physical)] }) };
  const source = { options: { type: 'postgres', schema: 'public' }, transaction: async (isolation, action) => {
    assert.equal(isolation, 'REPEATABLE READ'); return action(manager);
  } };
  const settings = { read: async (_manager, lock) => { assert.equal(_manager, manager); assert.ok(!lock); return structuredClone(data.settings); } };
  return { data, queries, read: () => new SyrveStatusReadStore(source, settings).read([physical.id.toUpperCase(), physical.id]), physical };
}

test('internal reader restores the full ledger in one read-only snapshot without locks or mutations', async () => {
  const h = readerHarness(), before = structuredClone(h.data), result = await h.read();
  assert.equal(result.tables.size, 1); assert.equal(result.tables.get(h.physical.id).state.activeSyrveOrderIds.length, 1);
  assert.deepEqual(h.data, before);
  assert.equal(h.queries[0], 'SET TRANSACTION READ ONLY');
  assert.ok(h.queries.every((sql) => !/LIMIT/i.test(sql)));
});

test('the reader retains 4201 closed tombstones as well as active and suppressed UUIDs', async () => {
  const h = readerHarness();
  for (let n = 0; n < 4201; n++) h.data.versions.push({ link_id: id(6), order_id: id(1000 + n), timestamp: '300', state: 'closed', fingerprint: 'b'.repeat(64) });
  h.data.settings.links[0].manuallyFreedSyrveOrderIds = [id(10)];
  const value = (await h.read()).tables.get(h.physical.id).state;
  assert.equal(value.orderVersions.length, 4202);
  assert.deepEqual(value.manuallyFreedSyrveOrderIds, [id(10)]);
});

test('legacy, missing connection and disconnected settings decline POS contributions without repair', async () => {
  for (const change of [h => h.prepared = false, h => h.settings.prepared = false, h => h.settings.entity = null,
    h => h.settings.entity.status = 'disconnected', h => h.settings.entity.organizationId = null]) {
    const h = readerHarness(); change(h.data); const before = structuredClone(h.data);
    assert.equal((await h.read()).syncEnabled, false); assert.deepEqual(h.data, before);
  }
  const h = readerHarness(); h.data.settings.entity.status = 'error';
  assert.equal((await h.read()).tables.size, 1, 'same-revision last-good state survives an offline error');
});

test('new configuration and foreign saved scopes are never rebased by a read', async () => {
  for (const key of ['integration_id', 'configuration_revision', 'organization_id', 'molo_table_id', 'syrve_table_id']) {
    const h = readerHarness(); h.data.rows[0][key] = randomUUID(); const before = structuredClone(h.data);
    assert.equal((await h.read()).tables.size, 0); assert.deepEqual(h.data, before);
  }
});

test('missing or corrupt durable occupancy fails safely instead of guessing free or creating history', async () => {
  for (const change of [h => h.rows = [], h => h.versions = [], h => h.versions[0].timestamp = '9007199254740992']) {
    const h = readerHarness(); change(h.data); const before = structuredClone(h.data);
    await assert.rejects(h.read(), error => error.getStatus() === 503 && !error.message.includes(id(10)));
    assert.deepEqual(h.data, before);
  }
  const h = readerHarness(); h.data.rows = []; Object.assign(h.data.settings.links[0], { lastSyrveState: 'unknown', activeSyrveOrderIds: [] });
  assert.equal((await h.read()).tables.size, 0);
});

test('PostgreSQL status validator refuses unauthorized and remote targets before connecting', async () => {
  const { runSyrveStatusProjectionValidation } = await import('../scripts/syrve-status-projection-validation.mjs');
  await assert.rejects(runSyrveStatusProjectionValidation({}), /Fresh schema reference is disabled/);
  await assert.rejects(runSyrveStatusProjectionValidation({
    FRESH_SCHEMA_REFERENCE_ALLOW: 'true', DB_URL: 'postgres://production.example/molo',
  }), /refuses DB_URL/);
});
