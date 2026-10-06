const assert = require('node:assert/strict');
const test = require('node:test');
const { SyrveClient, isVerifiedLoadedProbe } = require('../dist/syrve/syrve-client.js');
const { SyrveWorkerRunner } = require('../dist/syrve/syrve-worker.runner.js');
const { SyrveWorkerStore } = require('../dist/syrve/syrve-worker.store.js');
const { syrveCaptureContext } = require('../dist/syrve/syrve-state.store.js');
const { batchTransport } = require('./helpers/syrve-batch-transport.js');
const { harness } = require('./helpers/syrve-state-harness.js');
const { consent } = require('./helpers/syrve-confirmed-worker.js');
const { id, row, probe } = require('./helpers/syrve-state-fixtures.js');
const ORG = id(80), TABLES = [id(81), id(82)];
const request = (tableId, orderIdBatches = [[]], context = tableId) => ({ tableId, orderIdBatches, visibilityContext: context });

function fixture(t, count = 2, options = {}) {
  for (const key of ['SYRVE_APP_ID', 'SYRVE_APP_CLIENT_SECRET']) {
    const before = process.env[key]; delete process.env[key];
    t.after(() => before === undefined ? delete process.env[key] : process.env[key] = before);
  }
  const tables = Array.from({ length: count }, (_, n) => id(81 + n));
  const tx = batchTransport(ORG, tables, options);
  t.mock.method(globalThis, 'fetch', tx.fetch);
  const controls = { loadingPlan: tx.plan, deadline: Date.now() + 45000, beforeCommand: async () => {} };
  const client = new SyrveClient();
  return { ...tx, tables, controls, client, read: (requests = tables.map(table => request(table))) =>
    client.probeLoadedOrderBatch('https://api-eu.syrve.live', 'synthetic-login', ORG, requests, controls) };
}

test('all 60 restaurant tables use one group load and 15 HTTP requests instead of 60 pipelines', async t => {
  const h = fixture(t, 60), probes = await h.read();
  assert.equal(probes.length, 60);
  assert.equal(h.calls.length, 15);
  assert.deepEqual(h.calls.filter(call => call.path.endsWith('/init_by_table')).map(call => call.body.tableIds), [h.tables]);
  assert.equal(h.calls.filter(call => call.path.endsWith('/by_table')).length, 2);
  assert.equal(h.calls.filter(call => call.path.endsWith('/commands/status')).length, 0);
  for (const [index, [probe]] of probes.entries()) {
    assert.equal(isVerifiedLoadedProbe(probe, h.tables[index], ORG, h.tables[index]), true);
    assert.equal(isVerifiedLoadedProbe(probe, h.tables[(index + 1) % 60], ORG, h.tables[index]), false);
    assert.equal(isVerifiedLoadedProbe(probe, h.tables[index], ORG, h.tables[(index + 1) % 60]), false);
  }
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

test('shared bills are fetched by ID once and lowercase UUID scopes remain compatible', async t => {
  const order = row({ organizationId: ORG, syrveTableId: TABLES[0] }, id(10));
  order.order.tableIds = TABLES;
  const h = fixture(t, 2, { rows: [order] });
  const probes = await h.read(TABLES.map(table => request(table.toUpperCase(), [[id(10).toUpperCase()]])));
  assert.equal(h.calls.filter(call => call.path.endsWith('/by_id')).length, 1);
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

for (const failure of ['rate limit', 'failed ID read', 'changed catalogue', 'guard', 'abort', 'nonfinite deadline', 'duplicate table', 'duplicate context']) {
  test('batch ' + failure + ' publishes no visibility receipts', async t => {
    const h = fixture(t, 2, { override: (path, body, calls) => {
      const loaded = calls.some(call => call.path.endsWith('/init_by_table'));
      if (loaded && failure === 'rate limit' && path.endsWith('/by_table')) return Response.json({}, { status: 429 });
      if (failure === 'failed ID read' && path.endsWith('/by_id')) return Response.json({}, { status: 403 });
      if (loaded && failure === 'changed catalogue' && path.endsWith('/available_restaurant_sections')) return { restaurantSections: [] };
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
  const client = new SyrveClient(), store = new SyrveWorkerStore(h.source, h.settings);
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

for (const offlineGroup of [0, 1]) {
  test('offline cash group ' + offlineGroup + ' does not discard the healthy group receipt', async t => {
    const groups = TABLES.map((table, index) => ({ terminalGroupId: id(index + 1), posVersion: '7.7.1', tableIds: [table] }));
    const healthy = 1 - offlineGroup;
    const bill = row({ organizationId: ORG, syrveTableId: TABLES[healthy] }, id(10));
    bill.order.terminalGroupId = groups[healthy].terminalGroupId;
    const h = fixture(t, 2, { groups, rows: [bill], override: path => path.endsWith('/is_alive') ? {
      correlationId: id(9300), isAliveStatus: groups.map((group, index) => ({ organizationId: ORG,
        terminalGroupId: group.terminalGroupId, isAlive: index !== offlineGroup })) } : undefined });
    const probes = await h.read();
    const good = probes[healthy][0], failed = probes[offlineGroup][0];
    assert.equal(good.byTable[0].id, id(10));
    assert.equal(isVerifiedLoadedProbe(good, TABLES[healthy], ORG, TABLES[healthy]), true);
    assert.equal(isVerifiedLoadedProbe(failed, TABLES[offlineGroup], ORG, TABLES[offlineGroup]), false);
    assert.equal(failed.checks.connection.status, 'error');
    assert.deepEqual(h.calls.filter(call => call.path.endsWith('/init_by_table')).map(call => call.body.tableIds), [[TABLES[healthy]]]);
  });
}

test('a failed group ID read cannot certify closure but another group still gets its receipt', async t => {
  const groups = TABLES.map((table, index) => ({ terminalGroupId: id(index + 1), posVersion: '7.7.1', tableIds: [table] }));
  const h = fixture(t, 2, { groups, override: (path, body) => path.endsWith('/by_id') && body.orderIds.includes(id(10))
    ? Response.json({}, { status: 500 }) : undefined });
  const probes = await h.read([request(TABLES[0], [[id(10)]]), request(TABLES[1])]);
  assert.equal(probes[0][0].checks.connection.status, 'error');
  assert.equal(isVerifiedLoadedProbe(probes[0][0], TABLES[0], ORG, TABLES[0]), false);
  assert.equal(isVerifiedLoadedProbe(probes[1][0], TABLES[1], ORG, TABLES[1]), true);
});

test('a rate limit in either group stops the shared batch rather than probing the next group', async t => {
  const groups = TABLES.map((table, index) => ({ terminalGroupId: id(index + 1), posVersion: '7.7.1', tableIds: [table] }));
  const h = fixture(t, 2, { groups, override: path => path.endsWith('/by_table') ? Response.json({}, { status: 429 }) : undefined });
  await assert.rejects(h.read(), error => error.getResponse().code === 'SYRVE_RATE_LIMITED');
  assert.equal(h.calls.filter(call => call.path.endsWith('/access_token')).length, 1);
  assert.equal(h.calls.filter(call => call.path.endsWith('/init_by_table')).length, 0);
});

test('PostgreSQL batch validator refuses remote or unapproved targets before loading the database driver', async () => {
  const { runSyrveBatchValidation } = await import('../scripts/syrve-batch-validation.mjs');
  await assert.rejects(runSyrveBatchValidation({}), /disabled/);
  await assert.rejects(runSyrveBatchValidation({ FRESH_SCHEMA_REFERENCE_ALLOW: 'true', DB_HOST: 'remote.example',
    DB_NAME: 'molo_fresh_schema_reference', DB_SYNCHRONIZE: 'true' }), /loopback|localhost/);
});

test('partial batch failure is persisted before releasing the database lease', async () => {
  const version = { id: id(100), revision: id(101) };
  const links = TABLES.map((table, index) => ({ id: id(110 + index), moloTableId: id(120 + index),
    syrveTableId: table, organizationId: ORG }));
  const captures = links.map(link => ({ linkId: link.id, physicalVersion: 'synthetic', orderIds: [[]], state: {
    scope: { integrationId: version.id, configurationRevision: version.revision, organizationId: ORG,
      moloTableId: link.moloTableId, syrveTableId: link.syrveTableId }, localRevision: id(130) } }));
  let enter, resume, released = false, persisted = false;
  const entered = new Promise(resolve => { enter = resolve; }), waiting = new Promise(resolve => { resume = resolve; });
  const store = { claim: async () => ({ status: 'claimed', lease: { id: id(140), version, links } }),
    captureBatch: async () => captures, guardBatch: async () => ({ organizationId: ORG, groups: [] }),
    apply: async () => ({ code: null }), failure: async (_, link, code, progress) => {
      assert.equal(link, links[0].id); assert.equal(code, 'SYRVE_INVALID_RESPONSE'); assert.equal(progress, true);
      enter(); await waiting; persisted = true;
    }, release: async () => { released = true; assert.equal(persisted, true); } };
  const batchProbe = async () => captures.map((capture, index) => {
    const value = probe(capture.state.scope, []);
    if (index === 0) value.checks.connection = { status: 'error', code: 'SYRVE_INVALID_RESPONSE' };
    return [{ orderIds: [], probe: value }];
  });
  const pending = new SyrveWorkerRunner(store, () => assert.fail('single table probe called'), batchProbe).run();
  await entered; assert.equal(released, false); resume();
  assert.deepEqual(await pending, { status: 'failed', processed: 1, code: 'SYRVE_INVALID_RESPONSE' });
  assert.equal(released, true);
});
