const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const { SyrveClient } = require('../dist/syrve/syrve-client.js');
const { SyrveIntegrationService } = require('../dist/syrve/syrve-integration.service.js');
const { buildSyrveOrderObservation, parseSyrveOrders, parsePosAvailability } = require('../dist/syrve/syrve-order-observer.js');

const id = (n) => `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ORG = id(1), GROUP = id(2), GROUP2 = id(3), TABLE = id(10), TABLE2 = id(11), MOLO = id(20), MOLO2 = id(21);
const ORDER = id(30), ORDER2 = id(31), ORDER3 = id(32);
const LOGIN = 'observation-test-restaurant-secret', TOKEN = 'observation-test-backend-token';
const BASE = 'https://api-eu.syrve.live';
const link = (syrveTableId = TABLE, activeSyrveOrderIds = []) => ({
  id: id(syrveTableId === TABLE ? 70 : 71), integrationId: id(60), organizationId: ORG,
  moloTableId: syrveTableId === TABLE ? MOLO : MOLO2, syrveTableId, lastKnownNumber: 12,
  lastSeenAt: null, lastSyncedAt: null, lastSyrveState: activeSyrveOrderIds.length ? 'open' : 'unknown',
  activeSyrveOrderIds, manuallyFreedSyrveOrderIds: [], updatedAt: '2026-10-01T00:00:00Z',
});
const wrapper = (orderId = ORDER, status = 'New', tableIds = [TABLE], timestamp = 100, group = GROUP) => ({
  id: orderId, organizationId: ORG, timestamp, creationStatus: 'Success',
  order: { tableIds, status, terminalGroupId: group,
    sum: 999, processedPaymentsSum: 999, whenClosed: '2026-10-01 01:00:00.000',
    customer: { name: LOGIN, phone: TOKEN }, items: [{ name: LOGIN }], externalData: { token: TOKEN } },
});
const orders = (...rows) => ({ correlationId: id(99), orders: rows });
const groups = (active = [GROUP], sleeping = []) => ({
  terminalGroups: [{ organizationId: ORG, items: active.map((groupId) => ({ id: groupId, organizationId: ORG, name: 'Каса' })) }],
  terminalGroupsInSleep: [{ organizationId: ORG, items: sleeping.map((groupId) => ({ id: groupId, organizationId: ORG, name: 'Спляча каса' })) }],
});
const sections = (tables = [{ id: TABLE, group: GROUP, isDeleted: false }]) => ({
  restaurantSections: [...new Set(tables.map((table) => table.group))].map((groupId, index) => ({
    id: id(80 + index), name: 'Зал', terminalGroupId: groupId,
    tables: tables.filter((table) => table.group === groupId).map((table, i) => ({
      id: table.id, number: 12 + i, name: 'Стіл', isDeleted: table.isDeleted,
    })),
  })),
});
const availability = (alive = [GROUP], offline = []) => ({ correlationId: id(98),
  isAliveStatus: [...alive.map((terminalGroupId) => ({ terminalGroupId, organizationId: ORG, isAlive: true })),
    ...offline.map((terminalGroupId) => ({ terminalGroupId, organizationId: ORG, isAlive: false }))] });

function setup(t, overrides = {}) {
  const keys = ['SYRVE_APP_ID', 'SYRVE_APP_CLIENT_SECRET', 'SYRVE_CREDENTIALS_SECRET', 'NODE_ENV', 'RENDER_EXTERNAL_URL'];
  const old = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  t.after(() => { for (const key of keys) {
    if (old[key] === undefined) delete process.env[key]; else process.env[key] = old[key];
  } });
  process.env.SYRVE_APP_ID = '';
  process.env.SYRVE_APP_CLIENT_SECRET = '';
  process.env.SYRVE_CREDENTIALS_SECRET = 'observation-test-long-storage-secret';
  process.env.NODE_ENV = 'production';
  process.env.RENDER_EXTERNAL_URL = '';
  const routes = {
    '/api/1/access_token': { token: TOKEN }, '/api/v2/access_token': { token: TOKEN },
    '/api/1/organizations': { organizations: [{ id: ORG, name: 'MOLO' }] },
    '/api/1/terminal_groups': groups(), '/api/1/reserve/available_restaurant_sections': sections(),
    '/api/1/terminal_groups/is_alive': availability(),
    '/api/1/order/by_table': orders(wrapper()), '/api/1/order/by_id': orders(wrapper()), ...overrides,
  };
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const path = new URL(url).pathname;
    calls.push({ path, ...options, body: JSON.parse(options.body) });
    assert.ok(path in routes, `unexpected upstream command: ${path}`);
    const value = typeof routes[path] === 'function' ? await routes[path](options) : routes[path];
    return value instanceof Response ? value : Response.json(value);
  });
  const client = new SyrveClient();
  const observe = async (links = [link()]) => buildSyrveOrderObservation(await client.probeOrders(BASE, LOGIN, ORG,
    links.map((item) => item.syrveTableId), [...new Set(links.flatMap((item) => item.activeSyrveOrderIds))]), links);
  return { client, calls, routes, observe };
}

function serviceSetup(t, overrides = {}) {
  const h = setup(t, overrides);
  const tables = [{ id: MOLO, tableNumber: '99', status: 'cleaning', x: 7, updatedAt: new Date('2026-10-01T00:00:00.000Z') },
    { id: MOLO2, tableNumber: '14', status: 'reserved', x: 9, updatedAt: new Date('2026-10-01T00:00:00.000Z') }];
  const state = { prepared: true, entity: { id: id(60), configurationRevision: randomUUID(),
    apiBaseUrl: BASE, status: 'connected', organizationId: ORG, syncEnabled: false }, links: [link(TABLE, [ORDER])] };
  let reads = 0;
  const writes = [];
  const store = {
    read: async () => { reads++; return structuredClone(state); },
    transaction: () => { writes.push('transaction'); throw new Error('observation must not open a write transaction'); },
    save: () => { writes.push('save'); throw new Error('observation must not save'); },
  };
  const service = new SyrveIntegrationService(store, { create: () => writes.push('audit') }, h.client,
    { find: async (options) => { assert.deepEqual(options, { select: { id: true, tableNumber: true, status: true, updatedAt: true } }); return structuredClone(tables); } });
  const encrypted = service.encrypt(LOGIN);
  Object.assign(state.entity, { apiLoginEncrypted: encrypted.encrypted, apiLoginIv: encrypted.iv, apiLoginAuthTag: encrypted.authTag });
  return { ...h, state, tables, service, writes, reads: () => reads, dto: () => ({ configurationRevision: state.entity.configurationRevision }) };
}

test('observer uses one bounded backend session, read endpoints, confirmed table UUIDs and all tracked order UUIDs', async (t) => {
  const h = setup(t);
  const result = await h.observe([link(TABLE, [ORDER])]);
  assert.deepEqual(h.calls.map((call) => call.path), ['/api/1/access_token', '/api/1/organizations',
    '/api/1/terminal_groups', '/api/1/reserve/available_restaurant_sections', '/api/1/terminal_groups/is_alive',
    '/api/1/order/by_table', '/api/1/order/by_id']);
  assert.deepEqual(h.calls[4].body, { organizationIds: [ORG], terminalGroupIds: [GROUP] });
  assert.deepEqual(h.calls[5].body, { organizationIds: [ORG], tableIds: [TABLE], statuses: null });
  assert.deepEqual(h.calls[6].body, { organizationIds: [ORG], orderIds: [ORDER], posOrderIds: null });
  for (const call of h.calls) {
    assert.equal(call.method, 'POST'); assert.equal(call.redirect, 'error');
    if (!call.path.endsWith('access_token')) assert.equal(call.headers.Authorization, `Bearer ${TOKEN}`);
  }
  assert.equal(result.tables[0].state, 'open');
  assert.deepEqual(result.tables[0].activeOrderIds, [ORDER]);
  assert.equal(result.syncEnabled, false); assert.equal(result.activationReady, false);
  assert.equal(result.statusesApplied, false); assert.equal(result.renamingApplied, false);
  assert.equal(result.diagnostics.posOrderVisibility, 'not_verified');
  assert.equal(result.diagnostics.initializationPerformed, false);
  assert.equal(result.diagnostics.posVersion, 'not_verified');
  assert.equal(result.checks.ordersByTable.minimumPosVersion, '7.4.6');
  assert.equal(result.checks.ordersByTable.permission, 'Orders: receiving');
  for (const secret of [LOGIN, TOKEN, 'customer', 'phone', 'items', 'sum', 'whenClosed', 'externalData']) {
    assert.ok(!JSON.stringify(result).includes(secret), `excluded ${secret}`);
  }
});

test('v2 observer retains application credentials only in authentication and never falls back', async (t) => {
  const h = setup(t);
  process.env.SYRVE_APP_ID = id(95); process.env.SYRVE_APP_CLIENT_SECRET = 'observation-app-secret';
  const result = await h.observe();
  assert.equal(h.calls[0].path, '/api/v2/access_token');
  assert.equal(result.authentication, 'v2');
  assert.ok(!JSON.stringify(result).includes('observation-app-secret'));
  h.routes['/api/v2/access_token'] = Response.json({ error: TOKEN }, { status: 401 });
  h.calls.length = 0;
  const failed = await h.observe();
  assert.equal(failed.checks.connection.code, 'SYRVE_AUTH_FAILED');
  assert.equal(h.calls.length, 1);
});

for (const status of ['New', 'Bill', 'Closed', 'Deleted']) {
  test(`${status} is classified from the explicit order status; payments and closing time never override it`, async (t) => {
    const row = wrapper(ORDER, status);
    const h = setup(t, { '/api/1/order/by_table': orders(row), '/api/1/order/by_id': orders(row) });
    const result = await h.observe([link(TABLE, [ORDER])]);
    assert.equal(result.orders[0].state, ['New', 'Bill'].includes(status) ? 'open' : 'closed');
    assert.deepEqual(result.tables[0].explicitlyClosedOrderIds, ['Closed', 'Deleted'].includes(status) ? [ORDER] : []);
    assert.equal(result.tables[0].state, ['New', 'Bill'].includes(status) ? 'open' : 'unknown');
    assert.equal(result.tables[0].complete, false);
  });
}

test('multiple orders and an order spanning multiple tables remain sets of UUID evidence', async (t) => {
  const h = setup(t, {
    '/api/1/reserve/available_restaurant_sections': sections([{ id: TABLE, group: GROUP, isDeleted: false }, { id: TABLE2, group: GROUP, isDeleted: false }]),
    '/api/1/order/by_table': orders(wrapper(ORDER, 'New', [TABLE, TABLE2]), wrapper(ORDER2, 'Bill'), wrapper(ORDER3, 'Closed')),
    '/api/1/order/by_id': orders(wrapper(ORDER, 'New', [TABLE, TABLE2]), wrapper(ORDER2, 'Bill'), wrapper(ORDER3, 'Closed')),
  });
  const links = [link(TABLE, [ORDER, ORDER2, ORDER3]), link(TABLE2, [ORDER])];
  const before = structuredClone(links);
  const result = await h.observe(links);
  assert.deepEqual(result.tables[0].activeOrderIds, [ORDER, ORDER2]);
  assert.deepEqual(result.tables[0].explicitlyClosedOrderIds, [ORDER3]);
  assert.deepEqual(result.tables[1].activeOrderIds, [ORDER]);
  assert.deepEqual(h.calls.at(-1).body.orderIds, [ORDER, ORDER2, ORDER3]);
  assert.deepEqual(links, before);
});

test('empty discovery and missing by-ID response are unknown, including previously active UUIDs', async (t) => {
  const h = setup(t, { '/api/1/order/by_table': orders(), '/api/1/order/by_id': orders() });
  const result = await h.observe([link(TABLE, [ORDER])]);
  assert.deepEqual(result.tables[0].activeOrderIds, []);
  assert.deepEqual(result.tables[0].explicitlyClosedOrderIds, []);
  assert.deepEqual(result.tables[0].unknownOrders, [{ id: ORDER, reason: 'missing_order' }]);
  assert.equal(result.tables[0].state, 'unknown');
  const first = await h.observe();
  assert.equal(first.tables[0].reason, 'unverified_pos_visibility');
  assert.equal(first.activationReady, false);
});

test('a known order missing from discovery is fetched by UUID; an explicit by-ID closure is evidence', async (t) => {
  const h = setup(t, { '/api/1/order/by_table': orders(), '/api/1/order/by_id': orders(wrapper(ORDER, 'Closed')) });
  const result = await h.observe([link(TABLE, [ORDER])]);
  assert.deepEqual(result.tables[0].explicitlyClosedOrderIds, [ORDER]);
  assert.equal(result.tables[0].state, 'unknown');
});

test('unknown status is unknown; arbitrary upstream status text is excluded', async (t) => {
  const row = wrapper(ORDER, 'FutureStatus');
  const h = setup(t, { '/api/1/order/by_table': orders(row), '/api/1/order/by_id': orders(row) });
  const result = await h.observe([link(TABLE, [ORDER])]);
  assert.equal(result.orders[0].state, 'unknown');
  assert.equal(result.orders[0].reason, 'unknown_order_status');
  assert.deepEqual(result.tables[0].explicitlyClosedOrderIds, []);
  assert.ok(!JSON.stringify(result).includes('FutureStatus'));
});

for (const creationStatus of ['InProgress', 'Error']) {
  test(`${creationStatus} cannot turn a supplied Closed payload or errorInfo into closure`, async (t) => {
    const row = { ...wrapper(ORDER, 'Closed'), creationStatus, errorInfo: { message: `${LOGIN} ${TOKEN}` } };
    const h = setup(t, { '/api/1/order/by_table': orders(row), '/api/1/order/by_id': orders(row) });
    const result = await h.observe([link(TABLE, [ORDER])]);
    assert.equal(result.orders[0].state, 'unknown');
    assert.deepEqual(result.tables[0].explicitlyClosedOrderIds, []);
    assert.equal(result.tables[0].unknownOrders[0].id, ORDER);
    assert.ok(!JSON.stringify(result).includes(LOGIN));
    assert.ok(!JSON.stringify(result).includes(TOKEN));
  });
}

test('newest provider timestamp wins; conflicting equal versions remain unknown', async (t) => {
  const h = setup(t, { '/api/1/order/by_table': orders(wrapper(ORDER, 'Closed', [TABLE], 100)),
    '/api/1/order/by_id': orders(wrapper(ORDER, 'New', [TABLE], 101)) });
  let result = await h.observe([link(TABLE, [ORDER])]);
  assert.deepEqual(result.tables[0].activeOrderIds, [ORDER]);
  assert.deepEqual(result.tables[0].explicitlyClosedOrderIds, []);
  h.routes['/api/1/order/by_id'] = orders(wrapper(ORDER, 'Bill', [TABLE], 100));
  result = await h.observe([link(TABLE, [ORDER])]);
  assert.equal(result.orders[0].reason, 'conflicting_order_versions');
  assert.deepEqual(result.tables[0].explicitlyClosedOrderIds, []);
});

test('an order moved to another table is not closure on its previously linked table', async (t) => {
  const h = setup(t, { '/api/1/order/by_table': orders(), '/api/1/order/by_id': orders(wrapper(ORDER, 'New', [TABLE2])) });
  const result = await h.observe([link(TABLE, [ORDER])]);
  assert.deepEqual(result.tables[0].explicitlyClosedOrderIds, []);
  assert.deepEqual(result.tables[0].unknownOrders, [{ id: ORDER, reason: 'order_table_changed' }]);
  assert.equal(result.tables.length, 1, 'an unlinked provider UUID never creates a MOLO result');
});

test('sleeping groups are diagnosed without waking them; offline groups are not queried for orders', async (t) => {
  const h = setup(t, { '/api/1/terminal_groups': groups([GROUP], [GROUP2]),
    '/api/1/terminal_groups/is_alive': availability([], [GROUP]) });
  const result = await h.observe([link(TABLE, [ORDER])]);
  assert.deepEqual(result.terminalGroups, [{ id: GROUP, state: 'offline' }, { id: GROUP2, state: 'sleeping' }]);
  assert.equal(result.tables[0].reason, 'unavailable_pos');
  assert.deepEqual(result.tables[0].explicitlyClosedOrderIds, []);
  assert.ok(!h.calls.some((call) => call.path.includes('/order/')));
});

test('one alive group can supply positive evidence while an offline linked table remains unknown', async (t) => {
  const h = setup(t, { '/api/1/terminal_groups': groups([GROUP, GROUP2]),
    '/api/1/reserve/available_restaurant_sections': sections([{ id: TABLE, group: GROUP, isDeleted: false }, { id: TABLE2, group: GROUP2, isDeleted: false }]),
    '/api/1/terminal_groups/is_alive': availability([GROUP], [GROUP2]),
    '/api/1/order/by_id': orders(wrapper(ORDER2, 'Closed', [TABLE2], 100, GROUP2)),
  });
  const result = await h.observe([link(), link(TABLE2, [ORDER2])]);
  assert.deepEqual(h.calls.find((call) => call.path === '/api/1/order/by_table').body.tableIds, [TABLE]);
  assert.equal(result.tables[0].state, 'open');
  assert.equal(result.tables[1].state, 'unknown');
  assert.deepEqual(result.tables[1].explicitlyClosedOrderIds, []);
  assert.equal(result.orders.find((order) => order.id === ORDER2).reason, 'unavailable_pos');
});

test('a different alive order group cannot close a table assigned to another POS group', async (t) => {
  const row = wrapper(ORDER, 'Closed', [TABLE], 100, GROUP2);
  const h = setup(t, { '/api/1/terminal_groups': groups([GROUP, GROUP2]),
    '/api/1/terminal_groups/is_alive': availability([GROUP, GROUP2]),
    '/api/1/order/by_table': orders(row), '/api/1/order/by_id': orders(row) });
  const result = await h.observe([link(TABLE, [ORDER])]);
  assert.equal(result.orders[0].state, 'unknown');
  assert.equal(result.orders[0].reason, 'order_terminal_group_changed');
  assert.deepEqual(result.tables[0].explicitlyClosedOrderIds, []);
});

for (const [label, tableRows, expected] of [
  ['missing', [], 'missing_table'], ['deleted', [{ id: TABLE, group: GROUP, isDeleted: true }], 'deleted_table'],
]) {
  test(`${label} catalog UUID cannot imply closure or be replaced by number`, async (t) => {
    const h = setup(t, { '/api/1/reserve/available_restaurant_sections': sections(tableRows) });
    const result = await h.observe([link(TABLE, [ORDER])]);
    assert.equal(result.tables[0].reason, expected);
    assert.deepEqual(result.tables[0].explicitlyClosedOrderIds, []);
    assert.ok(!h.calls.some((call) => call.path.includes('/order/')));
  });
}

test('no active terminal groups yields unknown without section/availability/order commands', async (t) => {
  const h = setup(t, { '/api/1/terminal_groups': groups([], [GROUP]) });
  const result = await h.observe([link(TABLE, [ORDER])]);
  assert.equal(h.calls.length, 3);
  assert.equal(result.tables[0].state, 'unknown');
  assert.deepEqual(result.tables[0].explicitlyClosedOrderIds, []);
});

for (const [label, mutate] of [
  ['absent orders', (p) => delete p.orders], ['absent correlation ID', (p) => delete p.correlationId],
  ['duplicate order', (p) => p.orders.push(p.orders[0])], ['foreign organization', (p) => p.orders[0].organizationId = id(90)],
  ['invalid UUID', (p) => p.orders[0].id = 'invalid'], ['unsafe int64 timestamp', (p) => p.orders[0].timestamp = 9_007_199_254_740_992],
  ['fractional timestamp', (p) => p.orders[0].timestamp = 1.5], ['negative timestamp', (p) => p.orders[0].timestamp = -1],
  ['missing timestamp', (p) => delete p.orders[0].timestamp], ['unsupported creation status', (p) => p.orders[0].creationStatus = 'Unexpected'],
  ['Success with null payload', (p) => p.orders[0].order = null], ['absent status', (p) => delete p.orders[0].order.status],
  ['string table UUID list', (p) => p.orders[0].order.tableIds = TABLE], ['empty table UUID list', (p) => p.orders[0].order.tableIds = []],
  ['duplicate table UUID', (p) => p.orders[0].order.tableIds.push(TABLE)],
  ['unrelated discovery table', (p) => p.orders[0].order.tableIds = [TABLE2]],
  ['missing terminal group', (p) => delete p.orders[0].order.terminalGroupId],
]) {
  test(`${label} rejects the entire order response, including other valid Closed rows`, async (t) => {
    const payload = orders(wrapper(), wrapper(ORDER2, 'Closed')); mutate(payload);
    const h = setup(t, { '/api/1/order/by_table': payload });
    const result = await h.observe([link(TABLE, [ORDER2])]);
    assert.equal(result.checks.ordersByTable.code, 'SYRVE_INVALID_RESPONSE');
    assert.deepEqual(result.orders, []);
    assert.deepEqual(result.tables[0].explicitlyClosedOrderIds, []);
    assert.equal(result.tables[0].state, 'unknown');
  });
}

test('unexpected by-ID UUID invalidates the observation rather than accepting another order closure', async (t) => {
  const h = setup(t, { '/api/1/order/by_table': orders(wrapper(ORDER, 'Closed')),
    '/api/1/order/by_id': orders(wrapper(ORDER2, 'Closed')) });
  const result = await h.observe([link(TABLE, [ORDER])]);
  assert.equal(result.checks.ordersById.code, 'SYRVE_INVALID_RESPONSE');
  assert.deepEqual(result.tables[0].explicitlyClosedOrderIds, []);
  assert.equal(result.orders[0].state, 'unknown');
});

for (const [label, mutate] of [
  ['partial', (p) => p.isAliveStatus = []], ['duplicate', (p) => p.isAliveStatus.push(p.isAliveStatus[0])],
  ['foreign group', (p) => p.isAliveStatus[0].terminalGroupId = GROUP2],
  ['foreign organization', (p) => p.isAliveStatus[0].organizationId = id(90)],
  ['non-boolean', (p) => p.isAliveStatus[0].isAlive = 'true'],
]) {
  test(`${label} POS availability response prevents all closure evidence`, async (t) => {
    const payload = availability(); mutate(payload);
    const h = setup(t, { '/api/1/terminal_groups/is_alive': payload });
    const result = await h.observe([link(TABLE, [ORDER])]);
    assert.equal(result.checks.posAvailability.code, 'SYRVE_INVALID_RESPONSE');
    assert.deepEqual(result.tables[0].explicitlyClosedOrderIds, []);
    assert.ok(!h.calls.some((call) => call.path.includes('/order/')));
  });
}

for (const [status, code] of [[401, 'SYRVE_AUTH_FAILED'], [403, 'SYRVE_ACCESS_DENIED'],
  [429, 'SYRVE_RATE_LIMITED'], [504, 'SYRVE_TIMEOUT'], [500, 'SYRVE_UNAVAILABLE']]) {
  for (const endpoint of ['/api/1/terminal_groups/is_alive', '/api/1/order/by_table', '/api/1/order/by_id']) {
    test(`${endpoint} HTTP ${status} is a safe diagnostic and never closure`, async (t) => {
      const h = setup(t, { [endpoint]: Response.json({ error: `${LOGIN} ${TOKEN}` }, { status }) });
      const result = await h.observe([link(TABLE, [ORDER])]);
      const key = endpoint.endsWith('is_alive') ? 'posAvailability' : endpoint.endsWith('by_table') ? 'ordersByTable' : 'ordersById';
      assert.equal(result.checks[key].code, code);
      assert.deepEqual(result.tables[0].explicitlyClosedOrderIds, []);
      assert.equal(result.tables[0].state, 'unknown');
      for (const secret of [LOGIN, TOKEN, 'errorInfo']) assert.ok(!JSON.stringify(result).includes(secret));
    });
  }
}

test('offline read, invalid JSON and oversized response preserve unknown without upstream detail', async (t) => {
  const h = setup(t, { '/api/1/order/by_table': () => { throw new Error(`${LOGIN} ${TOKEN}`); } });
  let result = await h.observe([link(TABLE, [ORDER])]);
  assert.equal(result.checks.ordersByTable.code, 'SYRVE_UNAVAILABLE');
  h.routes['/api/1/order/by_table'] = new Response('{bad', { headers: { 'Content-Type': 'application/json' } });
  result = await h.observe([link(TABLE, [ORDER])]);
  assert.equal(result.checks.ordersByTable.code, 'SYRVE_INVALID_RESPONSE');
  h.routes['/api/1/order/by_table'] = new Response('x'.repeat(1_048_577), { headers: { 'Content-Type': 'application/json' } });
  result = await h.observe([link(TABLE, [ORDER])]);
  assert.equal(result.checks.ordersByTable.code, 'SYRVE_INVALID_RESPONSE');
  assert.deepEqual(result.tables[0].explicitlyClosedOrderIds, []);
});

test('12-second request deadline prevents a stalled fetch from producing closure', async (t) => {
  const h = setup(t, { '/api/1/order/by_table': (options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error(`${TOKEN} timeout`)), { once: true });
  }) });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = h.observe([link(TABLE, [ORDER])]);
  // Flush the finite preceding mock HTTP/body work before advancing the request timer.
  while (!h.calls.some((call) => call.path === '/api/1/order/by_table')) await new Promise(setImmediate);
  t.mock.timers.tick(12_000);
  const result = await pending;
  assert.equal(result.checks.ordersByTable.code, 'SYRVE_TIMEOUT');
  assert.deepEqual(result.tables[0].explicitlyClosedOrderIds, []);
});

test('the request deadline also aborts a stalled JSON body after successful headers', async (t) => {
  let pulling = false;
  const h = setup(t, { '/api/1/order/by_table': (options) => new Response(new ReadableStream({
    start(controller) {
      options.signal.addEventListener('abort', () => controller.error(new Error(TOKEN)), { once: true });
    },
    pull() { pulling = true; },
  }), { headers: { 'Content-Type': 'application/json' } }) });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = h.observe([link(TABLE, [ORDER])]);
  while (!pulling) await new Promise(setImmediate);
  t.mock.timers.tick(12_000);
  const result = await pending;
  assert.equal(result.checks.ordersByTable.code, 'SYRVE_TIMEOUT');
  assert.deepEqual(result.tables[0].explicitlyClosedOrderIds, []);
});

test('one 45-second overall budget covers authentication, catalog, POS and both order methods', async (t) => {
  const h = setup(t);
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.now() });
  for (const path of ['/api/1/access_token', '/api/1/organizations', '/api/1/terminal_groups',
    '/api/1/reserve/available_restaurant_sections', '/api/1/terminal_groups/is_alive']) {
    const value = h.routes[path];
    h.routes[path] = () => { t.mock.timers.tick(8_000); return value; };
  }
  h.routes['/api/1/order/by_table'] = (options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error(TOKEN)), { once: true });
  });
  const started = Date.now();
  const pending = h.observe([link(TABLE, [ORDER])]);
  while (!h.calls.some((call) => call.path === '/api/1/order/by_table')) await new Promise(setImmediate);
  assert.equal(Date.now() - started, 40_000);
  t.mock.timers.tick(5_000);
  const result = await pending;
  assert.equal(result.checks.ordersByTable.code, 'SYRVE_TIMEOUT');
  assert.equal(Date.now() - started, 45_000);
  assert.ok(!h.calls.some((call) => call.path === '/api/1/order/by_id'));
});

test('ambiguous catalog UUIDs prevent all order reads without repairing physical mappings', async (t) => {
  const h = setup(t, { '/api/1/reserve/available_restaurant_sections': sections([
    { id: TABLE, group: GROUP, isDeleted: false }, { id: TABLE, group: GROUP, isDeleted: false },
  ]) });
  const result = await h.observe([link(TABLE, [ORDER])]);
  assert.equal(result.checks.restaurantSections.code, 'SYRVE_INVALID_RESPONSE');
  assert.deepEqual(result.tables[0].explicitlyClosedOrderIds, []);
  assert.ok(!h.calls.some((call) => call.path.includes('/order/')));
});

test('invalid/duplicate/excessive scopes are rejected locally before authentication', async (t) => {
  const h = setup(t);
  for (const [tables, known] of [[[], []], [['invalid'], []], [[TABLE, TABLE], []],
    [[TABLE], [ORDER, ORDER]], [Array.from({ length: 101 }, (_, i) => id(1000 + i)), []],
    [[TABLE], Array.from({ length: 201 }, (_, i) => id(1000 + i))]]) {
    await assert.rejects(h.client.probeOrders(BASE, LOGIN, ORG, tables, known), (e) => e.getStatus() === 400);
  }
  assert.equal(h.calls.length, 0);
});

test('selected organization must remain available before any order/POS read', async (t) => {
  const h = setup(t, { '/api/1/organizations': { organizations: [{ id: id(90), name: 'Інший ресторан' }] } });
  const result = await h.observe();
  assert.equal(result.checks.connection.code, 'SYRVE_ORGANIZATION_UNAVAILABLE');
  assert.equal(h.calls.length, 2);
});

test('actual integration observer leaves credentials, links/overrides, physical fields and audit untouched', async (t) => {
  const h = serviceSetup(t);
  h.state.links[0].manuallyFreedSyrveOrderIds = [ORDER];
  const before = structuredClone({ state: h.state, tables: h.tables });
  const result = await h.service.observeOrders(h.dto());
  assert.equal(result.configurationRevision, h.state.entity.configurationRevision);
  assert.deepEqual({ state: h.state, tables: h.tables }, before);
  assert.deepEqual(h.writes, []);
  assert.equal(h.reads(), 2);
  for (const secret of [LOGIN, TOKEN, h.state.entity.apiLoginEncrypted, h.state.entity.apiLoginIv, h.state.entity.apiLoginAuthTag]) {
    assert.ok(!JSON.stringify(result).includes(secret));
  }
});

for (const [label, mutate] of [
  ['disconnect', (h) => { h.state.entity.configurationRevision = randomUUID(); h.state.entity.status = 'not_connected'; h.state.entity.apiLoginEncrypted = null; }],
  ['organization change', (h) => { h.state.entity.configurationRevision = randomUUID(); h.state.entity.organizationId = id(90); }],
  ['remapping', (h) => { h.state.links[0].syrveTableId = TABLE2; }],
  ['manual-free override', (h) => { h.state.links[0].manuallyFreedSyrveOrderIds = [ORDER]; }],
  ['manual table-status action', (h) => { h.tables[0].status = 'occupied'; }],
  ['new observed order set', (h) => { h.state.links[0].activeSyrveOrderIds.push(ORDER2); }],
  ['rename', (h) => { h.tables[0].tableNumber = '100'; }],
  ['physical deletion', (h) => { h.tables.splice(0, 1); }],
  ['schema rollback', (h) => { h.state.prepared = false; }],
]) {
  test(`in-flight ${label} fences even a successful Closed response without writing anything`, async (t) => {
    const h = serviceSetup(t);
    h.routes['/api/1/order/by_table'] = () => { mutate(h); return orders(wrapper(ORDER, 'Closed')); };
    h.routes['/api/1/order/by_id'] = orders(wrapper(ORDER, 'Closed'));
    await assert.rejects(h.service.observeOrders(h.dto()), (e) => e.getStatus() === 409);
    assert.deepEqual(h.writes, []);
  });
}

test('failed read after concurrent disconnect cannot publish an old-configuration diagnostic', async (t) => {
  const h = serviceSetup(t);
  h.routes['/api/1/order/by_table'] = () => {
    h.state.entity.configurationRevision = randomUUID(); h.state.entity.status = 'not_connected';
    return Response.json({ error: TOKEN }, { status: 403 });
  };
  await assert.rejects(h.service.observeOrders(h.dto()), (e) => e.getStatus() === 409);
  assert.deepEqual(h.writes, []);
});

for (const field of ['status', 'tableNumber']) {
  test(`in-flight ${field} change and restore is still stale when the table update version changed`, async (t) => {
    const h = serviceSetup(t);
    const original = structuredClone(h.tables[0]);
    h.routes['/api/1/order/by_table'] = () => {
      h.tables[0][field] = field === 'status' ? 'occupied' : '100';
      h.tables[0].updatedAt = new Date('2026-10-01T00:00:01.000Z');
      h.tables[0][field] = original[field];
      h.tables[0].updatedAt = new Date('2026-10-01T00:00:02.000Z');
      return orders(wrapper(ORDER, 'Closed'));
    };
    h.routes['/api/1/order/by_id'] = orders(wrapper(ORDER, 'Closed'));
    await assert.rejects(h.service.observeOrders(h.dto()), (e) => e.getStatus() === 409);
    assert.deepEqual({ ...h.tables[0], updatedAt: original.updatedAt }, original,
      'all requested table values returned to their original values');
    assert.deepEqual(h.writes, []);
  });
}

test('legacy schema, stale revision, disconnected state and absent/foreign links stop before any upstream request', async (t) => {
  const h = serviceSetup(t);
  await assert.rejects(h.service.observeOrders({ configurationRevision: randomUUID() }), (e) => e.getStatus() === 409);
  h.state.prepared = false;
  await assert.rejects(h.service.observeOrders(h.dto()), (e) => e.getStatus() === 503);
  h.state.prepared = true; h.state.entity.status = 'not_connected';
  await assert.rejects(h.service.observeOrders(h.dto()), (e) => e.getStatus() === 400);
  h.state.entity.status = 'connected'; h.state.links[0].organizationId = id(90);
  await assert.rejects(h.service.observeOrders(h.dto()), (e) => e.getStatus() === 409);
  h.state.links = [];
  await assert.rejects(h.service.observeOrders(h.dto()), (e) => e.getStatus() === 400);
  assert.equal(h.calls.length, 0);
  assert.deepEqual(h.writes, []);
});

test('parsers normalize UUID casing and reject mixed organizations without source mutation', () => {
  const payload = orders(wrapper()); payload.orders[0].id = ORDER.toUpperCase();
  payload.orders[0].organizationId = ORG.toUpperCase(); payload.orders[0].order.tableIds = [TABLE.toUpperCase()];
  const before = structuredClone(payload);
  const parsed = parseSyrveOrders(payload, ORG, { tableIds: [TABLE] });
  assert.equal(parsed[0].id, ORDER); assert.deepEqual(parsed[0].tableIds, [TABLE]);
  assert.deepEqual(payload, before);
  assert.throws(() => parsePosAvailability(availability([GROUP]), id(90), [GROUP]));
});
