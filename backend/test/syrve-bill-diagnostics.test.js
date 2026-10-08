const assert = require('node:assert/strict');
const test = require('node:test');
const { parseSyrveBill } = require('../dist/syrve/syrve-bill-diagnostics.js');
const { SyrveClient } = require('../dist/syrve/syrve-client.js');
const { SyrveIntegrationService } = require('../dist/syrve/syrve-integration.service.js');
const { withSyrveOperation } = require('../dist/syrve/syrve-operation-context.js');
const ORG = 'a0000000-0000-4000-8000-000000000001';
const POS = 'b0000000-0000-4000-8000-000000000001';
const CLOUD = 'c0000000-0000-4000-8000-000000000001';
const TABLE = 'd0000000-0000-4000-8000-000000000001';
const GROUP = 'e0000000-0000-4000-8000-000000000001';
const VERSION = 'f0000000-0000-4000-8000-000000000001';
const BASE = 'https://api-eu.syrve.live', LOGIN = 'fixture-api-secret';
function payload() {
  return { correlationId: VERSION, orders: [{ id: CLOUD, posId: POS, organizationId: ORG,
    timestamp: 1, creationStatus: 'Success', order: { number: 42, status: 'New',
      tableIds: [TABLE], terminalGroupId: GROUP, customer: { name: 'private-guest' },
      items: ['private-item'], phone: 'private-phone' }, errorInfo: 'private-error' }] };
}
function transport(t, responses) {
  const keys = ['SYRVE_APP_ID', 'SYRVE_APP_CLIENT_SECRET'];
  const env = keys.map(key => process.env[key]);
  keys.forEach(key => process.env[key] = '');
  t.after(() => keys.forEach((key, i) => env[i] === undefined ? delete process.env[key] : process.env[key] = env[i]));
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    const response = responses.shift(); assert.ok(response, 'unexpected extra provider request');
    return typeof response === 'function' ? response() : response;
  });
  return { client: new SyrveClient(require('./helpers/syrve-test-request-limiter.js')), calls };
}
const auth = () => [Response.json({ token: 'fixture-token' }), Response.json({ organizations: [{ id: ORG, name: 'MOLO' }] })];
const empty = () => Response.json({ correlationId: VERSION, orders: [] });

test('POS and Cloud identities remain distinct and private order data never leaves the parser', () => {
  const result = parseSyrveBill(payload(), ORG, POS, 'posId');
  assert.equal(result.id, CLOUD); assert.equal(result.posId, POS); assert.equal(result.number, 42);
  assert.deepEqual(result.tableIds, [TABLE]); assert.doesNotMatch(JSON.stringify(result), /private-/);
  assert.equal(parseSyrveBill(payload(), ORG, CLOUD, 'orderId').id, CLOUD);
});

test('wrong identity, foreign organization and malformed evidence fail closed', () => {
  const mutations = [p => p.orders.push(p.orders[0]), p => p.orders[0].organizationId = GROUP,
    p => p.orders[0].posId = GROUP, p => p.orders[0].timestamp = -1,
    p => p.orders[0].timestamp = Number.MAX_SAFE_INTEGER + 1,
    p => p.orders[0].order.tableIds.push(TABLE), p => p.orders[0].order.tableIds = ['8'],
    p => p.orders[0].order.terminalGroupId = 'invalid', p => p.orders[0].order.number = '42',
    p => p.orders[0].creationStatus = 'Other', p => p.orders[0].order.status = '',
    p => delete p.correlationId];
  for (const mutate of mutations) { const p = payload(); mutate(p); assert.throws(() => parseSyrveBill(p, ORG, POS, 'posId')); }
  const p = payload(); p.orders[0].id = POS; p.orders[0].posId = GROUP;
  assert.throws(() => parseSyrveBill(p, ORG, POS, 'posId'), 'Cloud ID must not override a conflicting POS ID');
  assert.throws(() => parseSyrveBill(payload(), ORG, POS, 'orderId'));
});

test('in-progress and error wrappers expose only identity; unknown states and closed bills stay diagnostic', () => {
  for (const creationStatus of ['InProgress', 'Error']) {
    const p = payload(); p.orders[0].creationStatus = creationStatus;
    p.orders[0].order = 'private-broken-body';
    const result = parseSyrveBill(p, ORG, POS, 'posId');
    assert.equal(result.status, null); assert.equal(result.number, null); assert.deepEqual(result.tableIds, []);
    assert.doesNotMatch(JSON.stringify(result), /private-/);
  }
  const p = payload(); p.orders[0].order.status = 'Closed'; p.orders[0].order.tableIds = [];
  assert.equal(parseSyrveBill(p, ORG, POS, 'posId').status, 'Closed');
  p.orders[0].order.status = 'unrecognized-private-status';
  assert.equal(parseSyrveBill(p, ORG, POS, 'posId').status, 'Unknown');
  p.orders[0].id = POS; p.orders[0].posId = null;
  assert.equal(parseSyrveBill(p, ORG, POS, 'posId').posId, null);
});

test('lookup sends the documented POS selector first through the shared request guard', async t => {
  const h = transport(t, [...auth(), Response.json(payload())]); let guards = 0, ownerChecks = 0;
  const result = await withSyrveOperation({ deadline: Date.now() + 180000, signal: new AbortController().signal,
    beforeRequest: async () => { ownerChecks++; } }, () => h.client.lookupBill(BASE, LOGIN, ORG.toUpperCase(), POS.toUpperCase(), async () => { guards++; }));
  assert.equal(result.lookup, 'posId'); assert.equal(result.order.id, CLOUD);
  assert.deepEqual(h.calls[2].body, { organizationIds: [ORG], orderIds: null, posOrderIds: [POS] });
  assert.equal(h.calls.length, 3); assert.ok(guards >= 5); assert.equal(guards, ownerChecks);
  assert.doesNotMatch(JSON.stringify(result), /private-|fixture-api-secret|fixture-token/);
});

test('only a valid empty POS lookup permits Cloud fallback; two empty reads prove no closure', async t => {
  const h = transport(t, [...auth(), empty(), Response.json(payload()), empty(), empty()]);
  const found = await h.client.lookupBill(BASE, LOGIN, ORG, CLOUD, async () => {});
  assert.equal(found.lookup, 'orderId'); assert.equal(found.order.posId, POS);
  assert.deepEqual(h.calls[3].body, { organizationIds: [ORG], orderIds: [CLOUD], posOrderIds: null });
  const absent = await h.client.lookupBill(BASE, LOGIN, ORG, POS, async () => {});
  assert.equal(absent.lookup, null); assert.equal(absent.order, null); assert.equal(h.calls.length, 6);
});

test('provider failures and invalid POS evidence do not trigger a fallback query', async t => {
  for (const response of [Response.json({ orders: [] }), Response.json({}, { status: 403 })]) {
    const h = transport(t, [...auth(), response]);
    await assert.rejects(h.client.lookupBill(BASE, LOGIN, ORG, POS, async () => {}));
    assert.equal(h.calls.length, 3);
  }
});

test('a configuration change after a POS read prevents Cloud fallback', async t => {
  let stale = false;
  const h = transport(t, [...auth(), () => { stale = true; return empty(); }]);
  await assert.rejects(h.client.lookupBill(BASE, LOGIN, ORG, POS, async () => { if (stale) throw new Error('configuration changed'); }), /configuration changed/);
  assert.equal(h.calls.length, 3);
});

test('invalid identifiers and an expired or revoked operation send no HTTP requests', async t => {
  const h = transport(t, []);
  await assert.rejects(h.client.lookupBill(BASE, LOGIN, ORG, '42', async () => {}));
  await assert.rejects(h.client.lookupBill(BASE, LOGIN, ORG, POS, async () => { throw new Error('revoked'); }), /revoked/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(withSyrveOperation({ deadline: Date.now() + 10000, signal: controller.signal },
    () => h.client.lookupBill(BASE, LOGIN, ORG, POS, async () => {})));
  assert.equal(h.calls.length, 0);
});

function serviceHarness(t, mutate) {
  const saved = { prepared: true, entity: { id: GROUP, configurationRevision: VERSION, status: 'connected',
    organizationId: ORG, apiBaseUrl: BASE, apiLoginEncrypted: 'opaque', apiLoginIv: 'iv', apiLoginAuthTag: 'tag' },
    links: [{ id: VERSION, integrationId: GROUP, organizationId: ORG, moloTableId: POS,
      syrveTableId: TABLE, lastKnownNumber: 8, lastSyrveState: 'unknown' }] };
  let writes = 0;
  const store = { read: async () => structuredClone(saved), save: () => { writes++; }, transaction: () => { writes++; } };
  const client = { lookupBill: async (base, login, org, id, guard) => {
    assert.equal(base, BASE); assert.equal(login, LOGIN); assert.equal(org, ORG); assert.equal(id, POS);
    await guard(); mutate?.(saved); await guard();
    return { startedAt: '2026-10-08T07:00:00Z', checkedAt: '2026-10-08T07:00:01Z', lookup: 'posId',
      order: parseSyrveBill(payload(), ORG, POS, 'posId') };
  } };
  const service = new SyrveIntegrationService(store, { create: () => { writes++; } }, client,
    { find: async () => [{ id: POS, tableNumber: '8' }], save: () => { writes++; } });
  t.mock.method(service, 'decrypt', () => LOGIN);
  return { service, saved, writes: () => writes };
}
const request = { configurationRevision: VERSION, orderId: POS };

test('saved UUID bindings resolve the bill table without changing statuses, mappings or logs', async t => {
  const h = serviceHarness(t, saved => { saved.links[0].lastSyrveState = 'open'; });
  const result = await h.service.billDiagnostics(request);
  assert.equal(result.found, true); assert.equal(result.statusesApplied, false); assert.equal(result.bindingsApplied, false);
  assert.deepEqual(result.order.tables, [{ syrveTableId: TABLE, moloTableNumber: '8' }]);
  assert.equal(h.writes(), 0); assert.doesNotMatch(JSON.stringify(result), /private-|opaque|fixture-api-secret/);
});

test('missing or ambiguous UUID bindings do not guess a MOLO table from its number', async t => {
  for (const ambiguous of [false, true]) {
    const h = serviceHarness(t); h.saved.links = ambiguous ? [...h.saved.links, { ...h.saved.links[0], id: CLOUD }] : [];
    const result = await h.service.billDiagnostics(request);
    assert.deepEqual(result.order.tables, [{ syrveTableId: TABLE, moloTableNumber: null }]);
    assert.equal(h.writes(), 0);
  }
});

test('connection, credential and binding changes fence the report while worker ledger updates remain allowed', async t => {
  for (const mutate of [s => s.entity.configurationRevision = CLOUD, s => s.entity.apiLoginEncrypted = 'rotated',
    s => s.entity.organizationId = GROUP, s => s.entity.status = 'not_connected',
    s => s.links[0].syrveTableId = CLOUD, s => s.prepared = false]) {
    const h = serviceHarness(t, mutate);
    await assert.rejects(h.service.billDiagnostics(request), error => error.getStatus() === 409);
    assert.equal(h.writes(), 0);
  }
  const h = serviceHarness(t); h.saved.entity.configurationRevision = CLOUD;
  await assert.rejects(h.service.billDiagnostics(request), error => error.getStatus() === 409);
});
