require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const { Test } = require('@nestjs/testing');
const { Reflector } = require('@nestjs/core');
const { ValidationPipe } = require('@nestjs/common');
const { JwtAuthGuard } = require('../dist/auth/guards/jwt-auth.guard.js');
const { SyrveWebhookController, SyrveWebhookGuard } = require('../dist/syrve/syrve-webhook.controller.js');
const { SyrveWebhookService } = require('../dist/syrve/syrve-webhook.service.js');
const { SyrveClient } = require('../dist/syrve/syrve-client.js');
const { parseSyrveWebhookBatch, syrveWebhookToken, hasSyrveWebhookAuthorization, SyrveWebhookTopologyError } = require('../dist/syrve/syrve-webhook.js');
const { createSyrveTableSyncState, reduceSyrveWebhookOrder, reduceSyrveOrderState,
  reduceSyrveStaffAction, syrveTableStatusEvent } = require('../dist/syrve/syrve-state-reducer.js');
const { id, row, probe } = require('./helpers/syrve-state-fixtures.js');
const { batchTransport } = require('./helpers/syrve-batch-transport.js');
const ORG = id(80), REV = id(81), INTEGRATION = id(82), GROUP = id(1);
const TABLES = [id(83), id(84), id(85)], BILL = id(86), OTHER = id(87);
const topology = () => ({ organizationId: ORG, configurationRevision: REV, expiresAt: Date.now() + 120_000,
  tables: TABLES.map(table => ({ id: table, terminalGroupId: GROUP, isDeleted: false })),
  liveGroupIds: [GROUP], visibleTableIds: [...TABLES] });
const states = () => TABLES.map((syrveTableId, index) => createSyrveTableSyncState({ integrationId: INTEGRATION,
  configurationRevision: REV, organizationId: ORG, syrveTableId, moloTableId: id(90 + index) }, randomUUID()));
const event = (table = TABLES[0], bill = BILL, status = 'New', timestamp = 100) => ({
  eventType: 'TableOrderUpdate', eventTime: '2026-10-12 10:00:00.123', organizationId: ORG, correlationId: id(88),
  eventInfo: { ...row({ organizationId: ORG, syrveTableId: table }, bill, status, timestamp),
    order: { ...row({ organizationId: ORG, syrveTableId: table }, bill, status, timestamp).order,
      customer: { phone: 'private-phone' }, items: [{ name: 'private-item' }] } },
});
const order = (...args) => parseSyrveWebhookBatch([event(...args)]).orders[0];
const apply = (saved, incoming, scope = topology()) => reduceSyrveWebhookOrder(saved, incoming, scope, saved.map(() => randomUUID()));
function staff(saved, index = 0) {
  const state = saved[index];
  return saved.map((value, i) => i !== index ? value : reduceSyrveStaffAction(value, { expectedScope: state.scope,
    currentScope: state.scope, expectedRevision: state.localRevision, nextRevision: randomUUID(), action: 'manual_free' }).state);
}

test('callbacks normalize only bill evidence and reconcile equal versions before applying any action', () => {
  const parsed = parseSyrveWebhookBatch([event(), { eventType: 'TableOrderError', organizationId: ORG,
    eventInfo: { privateError: 'private-details' } }]);
  assert.equal(parsed.ignored, 1); assert.equal(parsed.orders.length, 1);
  assert.doesNotMatch(JSON.stringify(parsed), /private-/);
  assert.deepEqual(parseSyrveWebhookBatch(event()).orders, parsed.orders);
  assert.equal(parseSyrveWebhookBatch([event(), event()]).orders.length, 1);
  const conflict = parseSyrveWebhookBatch([event(), event(TABLES[1])]);
  assert.equal(conflict.orders[0].state, 'unknown');
  assert.deepEqual(apply(states(), conflict.orders[0]).map(value => value.status), [null, null, null]);
  for (const value of [[], Array(101).fill(event()), null, { events: [event()] },
    event(TABLES[0], BILL, 'New', -1), event(TABLES[0], BILL, 'New', '100'),
    { ...event(), organizationId: id(89) }, { ...event(), correlationId: 'bad' },
    { ...event(), eventInfo: { ...event().eventInfo, timestamp: Number.MAX_SAFE_INTEGER + 1 } }]) {
    assert.throws(() => parseSyrveWebhookBatch(value));
  }
  const unknown = event(); unknown.eventInfo.creationStatus = 'InProgress'; unknown.eventInfo.order = null;
  assert.equal(parseSyrveWebhookBatch([unknown]).orders[0].state, 'unknown');
});

test('opening overrides any prior physical mark once; bill updates and repeats preserve a later staff action', () => {
  let result = apply(states(), order());
  assert.deepEqual(result.map(value => value.status), ['occupied', null, null]);
  let saved = staff(result.map(value => value.state));
  for (const incoming of [order(), order(TABLES[0], BILL, 'Bill', 200), order(TABLES[0], BILL, 'Bill', 200)]) {
    result = apply(saved, incoming); assert.equal(result[0].status, null);
    saved = result.map(value => value.state);
    assert.deepEqual(saved[0].manuallyFreedSyrveOrderIds, [BILL]);
  }
  result = apply(saved, order(TABLES[0], BILL, 'Closed', 300));
  assert.equal(result[0].status, 'free'); assert.deepEqual(result[0].state.activeSyrveOrderIds, []);
  assert.equal(apply(result.map(value => value.state), order(TABLES[0], BILL, 'Closed', 300))[0].status, null);
});

test('partial callback preserves other active bills and frees only after the last confirmed closure', () => {
  let saved = apply(states(), order()).map(value => value.state);
  saved = apply(saved, order(TABLES[0], OTHER, 'New', 101)).map(value => value.state);
  let result = apply(saved, order(TABLES[0], BILL, 'Deleted', 200));
  assert.equal(result[0].status, null); assert.deepEqual(result[0].state.activeSyrveOrderIds, [OTHER]);
  result = apply(result.map(value => value.state), order(TABLES[0], OTHER, 'Closed', 201));
  assert.equal(result[0].status, 'free'); assert.equal(result[1].changed, false);
});

test('explicit transfer releases the source and occupies the destination once, retaining the real POS status', () => {
  let saved = apply(states(), order()).map(value => value.state);
  let result = apply(saved, order(TABLES[1], BILL, 'Bill', 200));
  assert.deepEqual(result.map(value => value.status), ['free', 'occupied', null]);
  assert.deepEqual(result[0].state.activeSyrveOrderIds, []);
  assert.deepEqual(result[1].state.activeSyrveOrderIds, [BILL]);
  assert.equal(result[0].state.orderVersions[0].fingerprint, result[1].state.orderVersions[0].fingerprint);
  saved = staff(staff(result.map(value => value.state), 0), 1);
  assert.deepEqual(apply(saved, order(TABLES[1], BILL, 'Bill', 200)).map(value => value.status), [null, null, null]);
  const stale = apply(saved, order(TABLES[2], BILL, 'Bill', 150));
  assert.deepEqual(stale.map(value => value.state), saved);
  assert.deepEqual(stale.map(value => value.status), [null, null, null]);
});

test('transfers retain another source bill, reject unverified destinations and never use disappearance', () => {
  let saved = apply(states(), order()).map(value => value.state);
  saved = apply(saved, order(TABLES[0], OTHER, 'New', 101)).map(value => value.state);
  const moved = apply(saved, order(TABLES[1], BILL, 'Bill', 200));
  assert.deepEqual(moved.map(value => value.status), [null, 'occupied', null]);
  assert.deepEqual(moved[0].state.activeSyrveOrderIds, [OTHER]);
  for (const mutate of [scope => scope.tables[1].isDeleted = true, scope => scope.tables[1].terminalGroupId = id(111),
    scope => scope.liveGroupIds = [], scope => scope.visibleTableIds = [TABLES[0]], scope => scope.tables.splice(1, 1)]) {
    const scope = topology(); mutate(scope);
    assert.throws(() => apply(saved, order(TABLES[1], BILL, 'Bill', 200), scope), SyrveWebhookTopologyError);
  }
});

test('equal-version conflict and unknown evidence retain membership until a newer usable version', () => {
  let saved = apply(states(), order()).map(value => value.state);
  let result = apply(saved, order(TABLES[0], BILL, 'Closed', 100));
  assert.equal(result[0].status, null); assert.deepEqual(result[0].state.activeSyrveOrderIds, [BILL]);
  assert.equal(result[0].state.orderVersions[0].fingerprint, null);
  saved = result.map(value => value.state);
  assert.equal(apply(saved, order(TABLES[0], BILL, 'Closed', 100))[0].status, null);
  result = apply(saved, order(TABLES[0], BILL, 'Closed', 101));
  assert.equal(result[0].status, 'free');
});

test('an unresolved peer blocks the last release without discarding active membership', () => {
  const saved = apply(states(), order()).map(value => value.state);
  saved[0].orderVersions.push({ id: OTHER, timestamp: 100, state: 'unknown', fingerprint: null });
  const result = apply(saved, order(TABLES[0], BILL, 'Closed', 200));
  assert.equal(result[0].status, null); assert.deepEqual(result[0].state.activeSyrveOrderIds, [BILL]);
  assert.ok(result[0].diagnostics.includes('unknown_orders'));
});

test('legacy transfer repair removes membership atomically but preserves the physical source status', () => {
  let saved = apply(states(), order()).map(value => value.state);
  const moved = apply(saved, order(TABLES[1], BILL, 'Bill', 200));
  saved[0].orderVersions = [{ ...moved[0].state.orderVersions[0], state: 'unknown' }];
  saved = staff(saved);
  let result = apply(saved, order(TABLES[1], BILL, 'Bill', 200));
  assert.equal(result[0].status, null); assert.deepEqual(result[0].state.activeSyrveOrderIds, []);
  assert.equal(result[0].state.orderVersions[0].state, 'closed');
  assert.equal(apply(result.map(value => value.state), order(TABLES[1], BILL, 'Bill', 200))[0].status, null);
  saved[0].orderVersions.push({ id: OTHER, timestamp: 200, state: 'unknown', fingerprint: null });
  result = apply(saved, order(TABLES[1], BILL, 'Bill', 200));
  assert.deepEqual(result[0].state.activeSyrveOrderIds, [BILL]);
  assert.equal(result[0].state.orderVersions.find(value => value.id === BILL).state, 'unknown');
  assert.equal(result[0].status, null);
});

test('a subsequent poll cannot reopen an unseen destination using an older provider version', () => {
  const saved = apply(apply(states(), order()).map(value => value.state), order(TABLES[1], BILL, 'Bill', 200)).map(value => value.state);
  const state = saved[2];
  const result = reduceSyrveOrderState(state, { expectedScope: state.scope, currentScope: state.scope,
    expectedRevision: state.localRevision, nextRevision: randomUUID(), visibilityVerified: true,
    knownOrderVersions: saved.flatMap(value => value.orderVersions),
    probe: probe(state.scope, [row(state.scope, BILL, 'Bill', 150)]) });
  assert.equal(result.changed, false); assert.deepEqual(result.state.activeSyrveOrderIds, []);
  assert.equal(syrveTableStatusEvent(state, result), null);
  assert.ok(result.diagnostics.includes('stale_order'));
});

test('revision-scoped secret rejects JWTs, wrong prefixes, missing headers and tokens from another revision', async t => {
  const previous = process.env.SYRVE_CREDENTIALS_SECRET;
  process.env.SYRVE_CREDENTIALS_SECRET = 'synthetic-webhook-test-key-only';
  t.after(() => previous === undefined ? delete process.env.SYRVE_CREDENTIALS_SECRET : process.env.SYRVE_CREDENTIALS_SECRET = previous);
  const token = syrveWebhookToken(REV);
  assert.equal(hasSyrveWebhookAuthorization(token, REV.toUpperCase()), true);
  assert.equal(hasSyrveWebhookAuthorization('Bearer ' + token, REV), true);
  for (const header of [undefined, 'Bearer owner', 'Bearer ' + syrveWebhookToken(id(112)), 'Basic ' + token,
    'bearer ' + token, token + ' ', ['Bearer ' + token]]) assert.equal(hasSyrveWebhookAuthorization(header, REV), false);
  let calls = 0;
  const module = await Test.createTestingModule({ controllers: [SyrveWebhookController],
    providers: [SyrveWebhookGuard, { provide: SyrveWebhookService, useValue: { receive: async () => { calls++; return { accepted: true }; } } }],
  }).compile();
  const app = module.createNestApplication({ logger: false });
  app.setGlobalPrefix('api');
  app.useGlobalGuards(new JwtAuthGuard(app.get(Reflector), { verifyToken: () => assert.fail('callbacks must not use a staff session') }));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(0, '127.0.0.1'); t.after(() => app.close());
  const base = await app.getUrl();
  for (const [header, status] of [[null, 401], ['Bearer owner', 401], ['Bearer ' + token, 200], [token, 200]]) {
    const before = calls;
    const response = await fetch(base + '/api/syrve-webhook/' + REV, { method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(header ? { Authorization: header } : {}) }, body: JSON.stringify([event()]) });
    assert.equal(response.status, status); assert.equal(calls - before, status === 200 ? 1 : 0);
    if (status === 200) assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.doesNotMatch(await response.text(), /private-|synthetic-webhook/);
  }
  const before = calls;
  const oversized = await fetch(base + '/api/syrve-webhook/' + REV, { method: 'POST', headers: {
    'Content-Type': 'application/json', Authorization: token }, body: JSON.stringify({ padding: 'x'.repeat(110_000) }) });
  assert.equal(oversized.status, 413); assert.equal(calls, before);
});

test('webhook topology is private, bounded and issued only after initialized complete transport reads', async t => {
  const tx = batchTransport(ORG, TABLES);
  t.mock.method(globalThis, 'fetch', tx.fetch);
  const client = new SyrveClient(require('./helpers/syrve-test-request-limiter.js'));
  assert.equal(client.webhookTopology(ORG, REV), null);
  await client.probeLoadedOrderBatch('https://api-eu.syrve.live', 'synthetic-webhook-login', ORG,
    TABLES.map(tableId => ({ tableId, orderIdBatches: [[]], visibilityContext: randomUUID() })),
    { loadingPlan: tx.plan, configurationRevision: REV, beforeCommand: async () => {} });
  const receipt = client.webhookTopology(ORG, REV);
  assert.deepEqual(receipt.visibleTableIds, TABLES);
  assert.ok(receipt.expiresAt > Date.now() && receipt.expiresAt <= Date.now() + 120_000);
  assert.doesNotMatch(JSON.stringify(receipt), /synthetic-|apiLogin|token/);
  receipt.liveGroupIds.length = 0;
  assert.deepEqual(client.webhookTopology(ORG, REV).liveGroupIds, [GROUP]);
  assert.equal(client.webhookTopology(ORG, id(113)), null);
  const now = Date.now(); t.mock.method(Date, 'now', () => now + 120_001);
  assert.equal(client.webhookTopology(ORG, REV), null);
});

test('fresh offline evidence immediately revokes a previously healthy cash-group receipt', async t => {
  let online = true;
  const tx = batchTransport(ORG, TABLES, { override: path => path.endsWith('/is_alive')
    ? { correlationId: id(114), isAliveStatus: [{ organizationId: ORG, terminalGroupId: GROUP, isAlive: online }] } : undefined });
  t.mock.method(globalThis, 'fetch', tx.fetch);
  const client = new SyrveClient(require('./helpers/syrve-test-request-limiter.js'));
  const load = () => client.probeLoadedOrderBatch('https://api-eu.syrve.live', 'synthetic-webhook-login', ORG,
    TABLES.map(tableId => ({ tableId, orderIdBatches: [[]], visibilityContext: randomUUID() })),
    { loadingPlan: tx.plan, configurationRevision: REV, beforeCommand: async () => {} });
  await load(); assert.ok(client.webhookTopology(ORG, REV));
  online = false; assert.deepEqual(await load(), [null, null, null]);
  assert.equal(client.webhookTopology(ORG, REV), null);
});

test('inactive, disconnected, rotated and cross-organization callbacks never capture or write table state', async t => {
  for (const change of [s => s.prepared = false, s => s.entity.status = 'not_connected',
    s => s.entity.configurationRevision = id(115), s => s.entity.organizationId = id(115), s => s.enabled = false]) {
    const snapshot = { prepared: true, entity: { id: INTEGRATION, organizationId: ORG, configurationRevision: REV, status: 'connected' }, links: [], enabled: true };
    change(snapshot);
    const service = new SyrveWebhookService({ manager: {}, options: { type: 'postgres' } },
      { read: async () => snapshot, transaction: () => assert.fail('revoked callback must not write') },
      { read: async () => ({ enabled: snapshot.enabled, plan: topology() }) },
      { webhookTopology: () => assert.fail('revoked callback must not use old topology') });
    await assert.rejects(service.receive(REV, [event()]), error => error.getStatus() === 409);
  }
});
