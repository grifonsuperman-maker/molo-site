const assert = require('node:assert/strict');
const test = require('node:test');
const { performance } = require('node:perf_hooks');
const { SyrveClient, isVerifiedLoadedProbe } = require('../dist/syrve/syrve-client.js');
const { SyrveWorkerRunner } = require('../dist/syrve/syrve-worker.runner.js');
const { SyrveWorkerStore } = require('../dist/syrve/syrve-worker.store.js');
const { syrveCaptureContext } = require('../dist/syrve/syrve-state.store.js');
const { batchTransport } = require('./helpers/syrve-batch-transport.js');
const { harness } = require('./helpers/syrve-state-harness.js');
const { consent } = require('./helpers/syrve-confirmed-worker.js');
const { id, row } = require('./helpers/syrve-state-fixtures.js');
const ORG = id(80), TABLES = [id(81), id(82)];
const request = (tableId, orderIdBatches = [[]], context = tableId) => ({ tableId, orderIdBatches, visibilityContext: context });

test('an unavailable register retains its tables without blocking a healthy register', async t => {
  const groups = [{ terminalGroupId: id(1), posVersion: '7.7.1', tableIds: [TABLES[0]] },
    { terminalGroupId: id(2), posVersion: '7.7.1', tableIds: [TABLES[1]] }];
  const h = fixture(t, 2, { groups, override: path => path.endsWith('/is_alive') ? { correlationId: id(9001),
    isAliveStatus: groups.map((group, index) => ({ organizationId: ORG, terminalGroupId: group.terminalGroupId, isAlive: index === 0 })) } : undefined });
  const probes = await h.read();
  assert.equal(isVerifiedLoadedProbe(probes[0][0], TABLES[0], ORG, TABLES[0]), true);
  assert.equal(probes[1], null);
  assert.deepEqual(h.calls.filter(call => call.path.endsWith('/init_by_table')).map(call => call.body.terminalGroupId), [id(1)]);
});

test('a table rejected after a staff action does not stop applying the other table', async () => {
  const links = TABLES.map((syrveTableId, index) => ({ id: id(700 + index), moloTableId: id(800 + index), organizationId: ORG, syrveTableId }));
  const lease = { id: id(900), version: { id: id(901), revision: id(902) }, links };
  const captures = links.map(link => ({ linkId: link.id, orderIds: [[]], state: { scope: {
    integrationId: lease.version.id, configurationRevision: lease.version.revision, organizationId: ORG,
    moloTableId: link.moloTableId, syrveTableId: link.syrveTableId } } }));
  const applied = [];
  const store = { claim: async () => ({ status: 'claimed', lease }), captureBatch: async () => captures,
    guardBatch: async () => ({ organizationId: ORG, groups: [] }), release: async () => {},
    apply: async (_, capture) => { applied.push(capture.linkId); return { code: capture === captures[0] ? 'SYRVE_LOCAL_STATE_CHANGED' : null }; } };
  const runner = new SyrveWorkerRunner(store, () => assert.fail('unexpected fallback'), async () => captures.map(() => [{ orderIds: [], probe: { checks: {} } }]));
  const result = await runner.run();
  assert.equal(result.status, 'observed'); assert.equal(result.processed, 1); assert.deepEqual(applied, links.map(link => link.id));
});

function fixture(t, count = 2, options = {}) {
  for (const key of ['SYRVE_APP_ID', 'SYRVE_APP_CLIENT_SECRET']) {
    const before = process.env[key]; delete process.env[key];
    t.after(() => before === undefined ? delete process.env[key] : process.env[key] = before);
  }
  const tables = Array.from({ length: count }, (_, n) => id(81 + n));
  const tx = batchTransport(ORG, tables, options);
  t.mock.method(globalThis, 'fetch', tx.fetch);
  const controls = { loadingPlan: tx.plan, deadline: Date.now() + 45000, beforeCommand: async () => {} };
  const client = new SyrveClient(options.limiter || require('./helpers/syrve-test-request-limiter.js'));
  return { ...tx, tables, controls, client, read: (requests = tables.map(table => request(table))) =>
    client.probeLoadedOrderBatch('https://api-eu.syrve.live', 'synthetic-login', ORG, requests, controls) };
}

test('60 tables use 7 cold requests and 3 warm requests, with a fresh load and one table read each time', async t => {
  const h = fixture(t, 60), probes = await h.read();
  assert.equal(probes.length, 60);
  assert.equal(h.calls.length, 7);
  assert.deepEqual(h.calls.filter(call => call.path.endsWith('/init_by_table')).map(call => call.body.tableIds), [h.tables]);
  assert.equal(h.calls.filter(call => call.path.endsWith('/by_table')).length, 1);
  assert.equal(h.calls.filter(call => call.path.endsWith('/commands/status')).length, 0);
  for (const [index, [probe]] of probes.entries()) {
    assert.equal(isVerifiedLoadedProbe(probe, h.tables[index], ORG, h.tables[index]), true);
    assert.equal(isVerifiedLoadedProbe(probe, h.tables[(index + 1) % 60], ORG, h.tables[index]), false);
    assert.equal(isVerifiedLoadedProbe(probe, h.tables[index], ORG, h.tables[(index + 1) % 60]), false);
  }
  const before = h.calls.length, again = await h.read();
  assert.deepEqual(h.calls.slice(before).map(call => call.path),
    ['/api/1/order/init_by_table', '/api/1/terminal_groups/is_alive', '/api/1/order/by_table']);
  assert.deepEqual(h.calls.at(-1).body.statuses, ['New', 'Bill']);
  assert.equal(again.length, 60);
  for (const [index, [probe]] of again.entries()) assert.equal(isVerifiedLoadedProbe(probe, h.tables[index], ORG, h.tables[index]), true);
});

test('batch filters each table and retains direct by-ID evidence about a transfer', async t => {
  const scope = { organizationId: ORG, syrveTableId: TABLES[1] }, moved = row(scope, id(10), 'Bill', 200);
  const h = fixture(t, 2, { rows: [moved] });
  const [[source], [destination]] = await h.read([request(TABLES[0], [[id(10)]]), request(TABLES[1])]);
  assert.deepEqual(source.byTable, []); assert.equal(source.byId[0].id, id(10));
  assert.deepEqual(source.byId[0].tableIds, [TABLES[1]]);
  assert.equal(destination.byTable[0].id, id(10)); assert.deepEqual(destination.byId, []);
  assert.equal(isVerifiedLoadedProbe(structuredClone(source), TABLES[0], ORG, TABLES[0]), false);
  source.byId[0].timestamp++;
  assert.equal(isVerifiedLoadedProbe(source, TABLES[0], ORG, TABLES[0]), false);
});

test('explicit shared bills reuse fresh table evidence without a redundant by-ID request', async t => {
  const order = row({ organizationId: ORG, syrveTableId: TABLES[0] }, id(10));
  order.order.tableIds = TABLES;
  const h = fixture(t, 2, { rows: [order] });
  const probes = await h.read(TABLES.map(table => request(table.toUpperCase(), [[id(10).toUpperCase()]])));
  assert.equal(h.calls.filter(call => call.path.endsWith('/by_id')).length, 0);
  for (const [index, [probe]] of probes.entries()) {
    assert.equal(probe.byId.length, 1); assert.equal(probe.byTable.length, 1);
    assert.equal(isVerifiedLoadedProbe(probe, TABLES[index].toUpperCase(), ORG, TABLES[index]), true);
  }
});

test('4201 saved IDs are fully paged after one load and every derived page stays independently bounded', async t => {
  const ids = Array.from({ length: 4201 }, (_, n) => id(10000 + n));
  const rows = ids.map(value => row({ organizationId: ORG, syrveTableId: TABLES[0] }, value, 'Closed', 200));
  const h = fixture(t, 2, { rows, override: path => path.endsWith('/by_table') ? { correlationId: id(9099), orders: [] } : undefined });
  const pages = [ids.slice(0, 2000), ids.slice(2000, 4000), ids.slice(4000)];
  const [probes] = await h.read([request(TABLES[0], pages), request(TABLES[1])]);
  assert.deepEqual(probes.map(probe => probe.byId.length), [2000, 2000, 201]);
  assert.deepEqual(h.calls.filter(call => call.path.endsWith('/by_id')).flatMap(call => call.body.orderIds), ids);
  assert.equal(h.calls.filter(call => call.path.endsWith('/init_by_table')).length, 1);
});

for (const failure of ['rate limit', 'failed ID read', 'expired changed catalogue', 'guard', 'abort', 'nonfinite deadline', 'duplicate table', 'duplicate context']) {
  test('batch ' + failure + ' publishes no visibility receipts', async t => {
    let now = 0;
    if (failure === 'expired changed catalogue') t.mock.method(performance, 'now', () => now);
    const h = fixture(t, 2, { override: (path, body, calls) => {
      const loaded = calls.some(call => call.path.endsWith('/init_by_table'));
      if (loaded && failure === 'rate limit' && path.endsWith('/by_table')) return Response.json({}, { status: 429 });
      if (failure === 'failed ID read' && path.endsWith('/by_id')) return Response.json({}, { status: 403 });
      if (loaded && failure === 'expired changed catalogue' && path.endsWith('/by_table')) now = 300_001;
      if (loaded && failure === 'expired changed catalogue' && path.endsWith('/available_restaurant_sections')) return { restaurantSections: [] };
    } });
    let requests = TABLES.map(table => request(table, [[id(10)]]));
    if (failure === 'guard') h.controls.beforeCommand = async () => { throw new Error('changed scope'); };
    if (failure === 'abort') h.controls.signal = AbortSignal.abort();
    if (failure === 'nonfinite deadline') h.controls.deadline = NaN;
    if (failure === 'duplicate table') requests[1].tableId = requests[0].tableId;
    if (failure === 'duplicate context') requests[1].visibilityContext = requests[0].visibilityContext;
    await assert.rejects(h.read(requests));
    if (['guard', 'abort', 'nonfinite deadline', 'duplicate table', 'duplicate context'].includes(failure)) assert.equal(h.calls.length, 0);
    else assert.equal(h.calls.filter(call => call.path.endsWith('/init_by_table')).length, 1);
  });
}

test('the production batch runner preserves the existing open and close table rule', async t => {
  const h = harness(); Object.assign(h.entity, { apiLoginEncrypted: 'synthetic', apiLoginIv: 'synthetic', apiLoginAuthTag: 'synthetic' }); consent(h);
  const scope = (await h.store.capture(h.table)).state.scope;
  const tx = batchTransport(scope.organizationId, [scope.syrveTableId]);
  t.mock.method(globalThis, 'fetch', tx.fetch);
  const client = new SyrveClient(require('./helpers/syrve-test-request-limiter.js')), store = new SyrveWorkerStore(h.source, h.settings);
  const batchProbe = async (captures, lease, controls) => {
    const probes = await client.probeLoadedOrderBatch('https://api-eu.syrve.live', 'synthetic-login', scope.organizationId,
      captures.map(c => request(c.state.scope.syrveTableId, c.orderIds, syrveCaptureContext(lease, c))), controls);
    return captures.map((c, index) => c.orderIds.map((orderIds, page) => ({ orderIds, probe: probes[index][page] })));
  };
  const run = () => new SyrveWorkerRunner(store, () => assert.fail('per-table pipeline called'), batchProbe).run();
  tx.setRows([row(scope, id(10))]);
  assert.equal((await run()).status, 'observed');
  assert.equal(h.saved().physical.status, 'occupied');
  h.advance(300001);
  tx.setRows([row(scope, id(10), 'Closed', 200)]);
  assert.equal((await run()).status, 'observed');
  assert.equal(h.saved().physical.status, 'free');
  assert.deepEqual(h.saved().link.active_syrve_order_ids, []);
});

test('each of two cash groups loads once with its exact consented UUID set', async t => {
  const groups = TABLES.map((table, index) => ({ terminalGroupId: id(index + 1), posVersion: '7.7.1', tableIds: [table] }));
  const h = fixture(t, 2, { groups }); await h.read();
  assert.deepEqual(h.calls.filter(call => call.path.endsWith('/init_by_table')).map(call => call.body),
    groups.map(group => ({ organizationId: ORG, terminalGroupId: group.terminalGroupId, tableIds: group.tableIds })));
});

test('a missing known bill is checked by ID once, even when shared by several tables', async t => {
  const closed = row({ organizationId: ORG, syrveTableId: TABLES[0] }, id(10), 'Closed', 200);
  const open = row({ organizationId: ORG, syrveTableId: TABLES[1] }, id(11));
  const h = fixture(t, 2, { rows: [closed, open] });
  const probes = await h.read(TABLES.map(table => request(table, [[id(10), id(11)]])));
  assert.deepEqual(h.calls.filter(call => call.path.endsWith('/by_id')).map(call => call.body.orderIds), [[id(10)]]);
  for (const [probe] of probes) assert.deepEqual(probe.byId.map(order => order.id).sort(), [id(10), id(11)]);
});

test('unresolved creation records still receive direct ID reads and never become closure evidence', async t => {
  const unknown = row({ organizationId: ORG, syrveTableId: TABLES[0] }, id(10));
  unknown.creationStatus = 'InProgress'; unknown.order = null;
  const h = fixture(t, 2, { rows: [unknown] });
  const [[probe]] = await h.read([request(TABLES[0], [[id(10)]]), request(TABLES[1])]);
  assert.equal(h.calls.filter(call => call.path.endsWith('/by_id')).length, 1);
  assert.equal(probe.byId[0].state, 'unknown'); assert.equal(probe.byTable[0].state, 'unknown');
});

test('no cached occupancy is used: every warm cycle reads live availability and current orders', async t => {
  let offline = false;
  const opened = row({ organizationId: ORG, syrveTableId: TABLES[0] }, id(10));
  const h = fixture(t, 2, { rows: [opened], override: path => offline && path.endsWith('/is_alive')
    ? { correlationId: id(9001), isAliveStatus: [{ organizationId: ORG, terminalGroupId: id(1), isAlive: false }] } : undefined });
  assert.equal((await h.read())[0][0].byTable[0].state, 'open');
  h.setRows([]); const before = h.calls.length;
  const [[missing]] = await h.read([request(TABLES[0], [[id(10)]]), request(TABLES[1])]);
  assert.deepEqual(missing.byTable, []); assert.deepEqual(missing.byId, []);
  assert.equal(h.calls.length - before, 4);
  offline = true;
  assert.deepEqual(await h.read(), [null, null]);
});

test('dictionary TTL refreshes scope and organizations while retaining an unexpired backend token', async t => {
  let now = 0; t.mock.method(performance, 'now', () => now);
  const h = fixture(t, 2); await h.read(); now = 300_001;
  const before = h.calls.length; await h.read();
  assert.equal(h.calls.length - before, 6);
  assert.equal(h.calls.filter(call => call.path.endsWith('/access_token')).length, 1);
  assert.equal(h.calls.filter(call => call.path.endsWith('/available_restaurant_sections')).length, 2);
  assert.equal(h.calls.filter(call => call.path.endsWith('/organizations')).length, 2);
});

test('expired changed dictionaries are rejected before a new load', async t => {
  let now = 0, deleted = false; t.mock.method(performance, 'now', () => now);
  const h = fixture(t, 2, { override: path => deleted && path.endsWith('/available_restaurant_sections') ? { restaurantSections: [] } : undefined });
  await h.read(); now = 300_001; deleted = true;
  await assert.rejects(h.read(), error => error.getResponse().code === 'SYRVE_INVALID_RESPONSE');
  assert.equal(h.calls.filter(call => call.path.endsWith('/init_by_table')).length, 1);
});

test('configuration revisions fence dictionary reuse, and credential rotation requires fresh authentication', async t => {
  const h = fixture(t, 2); h.controls.configurationRevision = id(9900); await h.read();
  h.controls.configurationRevision = id(9901); let before = h.calls.length; await h.read();
  assert.equal(h.calls.length - before, 5);
  before = h.calls.length;
  await h.client.probeLoadedOrderBatch('https://api-eu.syrve.live', 'rotated-synthetic-login', ORG,
    TABLES.map(table => request(table)), h.controls);
  assert.equal(h.calls.length - before, 7);
  assert.equal(h.calls.filter(call => call.path.endsWith('/access_token')).length, 2);
});

for (const status of [401, 403]) test('provider ' + status + ' invalidates caches without automatically repeating a load', async t => {
  let denied = false;
  const h = fixture(t, 2, { override: path => denied && path.endsWith('/by_table') ? Response.json({}, { status }) : undefined });
  await h.read(); denied = true;
  await assert.rejects(h.read(), error => error.getResponse().code === (status === 401 ? 'SYRVE_AUTH_FAILED' : 'SYRVE_ACCESS_DENIED'));
  assert.equal(h.calls.filter(call => call.path.endsWith('/init_by_table')).length, 2);
  denied = false; const before = h.calls.length; await h.read();
  assert.equal(h.calls.length - before, 7);
  assert.equal(h.calls.filter(call => call.path.endsWith('/access_token')).length, 2);
});

test('token lifetime forces early refresh even if all previous reads succeeded', async t => {
  let now = 0; t.mock.method(performance, 'now', () => now);
  const h = fixture(t, 2); await h.read(); now = 50 * 60_000 + 1;
  await h.read(); assert.equal(h.calls.filter(call => call.path.endsWith('/access_token')).length, 2);
});

test('v2 JWT expiration and application credential rotation fence token reuse without legacy fallback', async t => {
  let now = 0; t.mock.method(performance, 'now', () => now);
  const jwt = 'e30.' + Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 180 })).toString('base64url') + '.synthetic';
  const h = fixture(t, 2, { override: path => path.endsWith('/access_token') ? { token: jwt } : undefined });
  process.env.SYRVE_APP_ID = id(9910); process.env.SYRVE_APP_CLIENT_SECRET = 'synthetic-app-secret';
  await h.read(); await h.read();
  assert.equal(h.calls.filter(call => call.path.endsWith('/access_token')).length, 1);
  now = 120_001; await h.read();
  assert.equal(h.calls.filter(call => call.path.endsWith('/access_token')).length, 2);
  process.env.SYRVE_APP_CLIENT_SECRET = 'rotated-synthetic-app-secret'; await h.read();
  assert.equal(h.calls.filter(call => call.path.endsWith('/access_token')).length, 3);
  assert.ok(h.calls.filter(call => call.path.endsWith('/access_token')).every(call => call.path === '/api/v2/access_token'));
});

test('credentials changed while authentication is in flight cannot cache the old token under the new identity', async t => {
  let rotated = false;
  const jwt = 'e30.' + Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url') + '.synthetic';
  const h = fixture(t, 2, { override: path => {
    if (!path.endsWith('/access_token')) return;
    if (!rotated) { process.env.SYRVE_APP_CLIENT_SECRET = 'rotated-in-flight-secret'; rotated = true; }
    return { token: jwt };
  } });
  process.env.SYRVE_APP_ID = id(9910); process.env.SYRVE_APP_CLIENT_SECRET = 'original-in-flight-secret';
  await h.read(); await h.read();
  const auth = h.calls.filter(call => call.path.endsWith('/access_token'));
  assert.equal(auth.length, 2);
  assert.deepEqual(auth.map(call => call.body.clientSecret), ['original-in-flight-secret', 'rotated-in-flight-secret']);
});

test('a mutated receipt cannot corrupt private cached dictionaries or expose credentials', async t => {
  const h = fixture(t, 2), [[first]] = await h.read();
  first.catalogTables[0].isDeleted = true; first.terminalGroups.active[0].posVersion = '1.0';
  assert.equal(isVerifiedLoadedProbe(first, TABLES[0], ORG, TABLES[0]), false);
  const [[second]] = await h.read();
  assert.equal(second.catalogTables[0].isDeleted, false); assert.equal(second.terminalGroups.active[0].posVersion, '7.7.1');
  assert.ok(!/synthetic-login|synthetic-batch-token/.test(JSON.stringify(second)));
});

test('a guard revoked after quota admission blocks every warm fetch despite cached access and dictionaries', async t => {
  const noop = require('./helpers/syrve-test-request-limiter.js'); let revoke = false, revoked = false;
  const h = fixture(t, 2, { limiter: { acquire: async () => { if (revoke) revoked = true; return noop.acquire(); }, cooldown: noop.cooldown } });
  h.controls.beforeCommand = async () => { if (revoked) throw new Error('scope changed during quota wait'); };
  await h.read(); const before = h.calls.length; revoke = true;
  await assert.rejects(h.read(), /scope changed/); assert.equal(h.calls.length, before);
});
