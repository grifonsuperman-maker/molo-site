const assert = require('node:assert/strict');
const test = require('node:test');
const { performance } = require('node:perf_hooks');
const { SyrveRequestLimiter, SyrveRequestLimitError, syrveRequestKey, syrveRetryAfterMs,
  SYRVE_REQUEST_GAP_MS, isFreshSyrvePermit } = require('../dist/syrve/syrve-request-limiter.js');
const { SyrveClient } = require('../dist/syrve/syrve-client.js');
const { CreateSyrveRequestLimits2026100600080: Migration } = require('../dist/migrations/2026100600080-CreateSyrveRequestLimits.js');

const BASE = 'https://api-eu.syrve.live', ORG = '11111111-2222-3333-4444-555555555555';
const GROUP = '22222222-2222-3333-4444-555555555555', TABLE = '33333333-2222-3333-4444-555555555555';
const LOGIN = 'synthetic-quota-login', KEY = syrveRequestKey(LOGIN);

function database() {
  const rows = new Map(), statements = [];
  const state = { now: 0, broken: false, afterClaim: () => {} };
  const source = { options: { type: 'postgres' }, transaction: async action => action({ query: async (sql, values) => {
    statements.push({ sql, values });
    if (state.broken) throw new Error('private-db-connection-details');
    if (sql.startsWith('SET ')) return [];
    const [key, delay] = values;
    if (sql.includes('RETURNING key_hash')) {
      if ((rows.get(key) ?? -Infinity) > state.now) return [];
      rows.set(key, state.now + delay); state.afterClaim(); return [{ key_hash: key }];
    }
    if (sql.startsWith('SELECT ')) return [{ wait_ms: Math.max(1, (rows.get(key) || 0) - state.now) }];
    rows.set(key, Math.max(rows.get(key) || 0, state.now + delay)); return [];
  } }) };
  return { source, state, rows, statements, limiter: () => new SyrveRequestLimiter(source) };
}

function transport(t, limiter, reply = () => Response.json({ token: 'synthetic-token' })) {
  for (const key of ['SYRVE_APP_ID', 'SYRVE_APP_CLIENT_SECRET']) {
    const previous = process.env[key]; delete process.env[key];
    t.after(() => previous === undefined ? delete process.env[key] : process.env[key] = previous);
  }
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => { calls.push(new URL(url).pathname); return reply(url, options); });
  return { client: new SyrveClient(limiter), calls };
}

const limited = e => e instanceof SyrveRequestLimitError && e.reason === 'limited';

test('same trimmed login has one bucket across organizations, tokens and client instances', async () => {
  assert.equal(KEY, syrveRequestKey(' ' + LOGIN + ' '));
  assert.notEqual(KEY, syrveRequestKey(LOGIN + '-other'));
  assert.match(KEY, /^[a-f0-9]{64}$/); assert.ok(!KEY.includes(LOGIN));
  const db = database(); await db.limiter().acquire(KEY);
  await assert.rejects(db.limiter().acquire(KEY, { deadline: Date.now() + 5 }), limited);
  assert.equal(db.rows.size, 1);
  assert.ok(db.statements.every(q => !JSON.stringify(q).includes(LOGIN)));
});

test('spacing admits at most two dispatches in every rolling minute, including minute boundaries', async t => {
  const db = database(); t.mock.method(performance, 'now', () => db.state.now);
  const admitted = [];
  for (const time of [0, 1, 29_999, 30_000, 31_000, 59_999, 60_000, 61_999, 62_000, 90_000, 93_000]) {
    db.state.now = time;
    try { const permit = await db.limiter().acquire(KEY, { deadline: Date.now() + 5 });
      assert.equal(isFreshSyrvePermit(permit), true); admitted.push(time); }
    catch (error) { assert.ok(limited(error)); }
  }
  assert.deepEqual(admitted, [0, 31_000, 62_000, 93_000]);
  for (const start of admitted) assert.ok(admitted.filter(time => time >= start && time < start + 60_000).length <= 2);
  assert.equal(SYRVE_REQUEST_GAP_MS, 31_000);
});

test('concurrent worker and Director attempts cannot admit an extra request', async () => {
  const db = database();
  const results = await Promise.allSettled(Array.from({ length: 40 }, () => db.limiter().acquire(KEY, { deadline: Date.now() + 100 })));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.ok(results.filter(r => r.status === 'rejected').every(r => limited(r.reason)));
});

test('database outage, missing migration and malformed bucket fail before HTTP', async t => {
  const db = database(); db.state.broken = true;
  const { client, calls } = transport(t, db.limiter());
  const result = await client.probeOrders(BASE, LOGIN, ORG, [TABLE], [], { deadline: Date.now() + 500 });
  assert.equal(result.checks.connection.code, 'SYRVE_RATE_GUARD_UNAVAILABLE');
  assert.equal(result.byTable, null); assert.equal(calls.length, 0);
  await assert.rejects(db.limiter().acquire('raw-secret'), e => e.reason === 'unavailable');
  assert.ok(!JSON.stringify(result).includes('private-db-connection-details'));
});

test('failed network attempt consumes its slot and a new process cannot refund it', async t => {
  const db = database(), { client, calls } = transport(t, db.limiter(), () => { throw new Error('private-provider-details'); });
  assert.equal((await client.probeOrders(BASE, LOGIN, ORG, [TABLE], [], { deadline: Date.now() + 100 })).checks.connection.code, 'SYRVE_UNAVAILABLE');
  const restarted = new SyrveClient(db.limiter());
  const value = await restarted.probeOrders(BASE, ' ' + LOGIN + ' ', ORG, [TABLE], [], { deadline: Date.now() + 100 });
  assert.equal(value.checks.connection.code, 'SYRVE_RATE_LIMITED'); assert.equal(calls.length, 1);
  assert.equal(value.byTable, null); assert.equal(value.byId, null);
});

test('upstream 429 persists Retry-After for every caller and never shortens a longer cooldown', async t => {
  const db = database(), { client, calls } = transport(t, db.limiter(), () => Response.json({}, { status: 429, headers: { 'retry-after': '180' } }));
  const result = await client.probeOrders(BASE, LOGIN, ORG, [TABLE], [], { deadline: Date.now() + 100 });
  assert.equal(result.checks.connection.code, 'SYRVE_RATE_LIMITED'); assert.equal(db.rows.get(KEY), 180_000);
  await db.limiter().cooldown(KEY, 60_000); assert.equal(db.rows.get(KEY), 180_000);
  await assert.rejects(db.limiter().acquire(KEY, { deadline: Date.now() + 100 }), limited);
  assert.equal(calls.length, 1);
});

test('Retry-After supports seconds and server dates and is safely bounded', () => {
  assert.equal(syrveRetryAfterMs('180', null), 180_000);
  assert.equal(syrveRetryAfterMs('Tue, 06 Oct 2026 10:02:00 GMT', 'Tue, 06 Oct 2026 10:00:00 GMT', 0), 120_000);
  for (const header of [null, '', 'bad', '-1', '0']) assert.equal(syrveRetryAfterMs(header, null), 60_000);
  assert.equal(syrveRetryAfterMs('999999999', null), 86_400_000);
});

test('expired deadline and cancellation do not consume a request slot', async () => {
  const db = database(), signal = new AbortController(); signal.abort();
  await assert.rejects(db.limiter().acquire(KEY, { signal: signal.signal }), e => e.reason === 'cancelled');
  await assert.rejects(db.limiter().acquire(KEY, { deadline: Date.now() - 1 }), limited);
  assert.equal(db.statements.length, 0);
});

test('cancelling a quota wait removes its listener and leaves the existing slot intact', async t => {
  const db = database(); db.rows.set(KEY, 50);
  const controller = new AbortController(), remove = t.mock.method(controller.signal, 'removeEventListener');
  const pending = db.limiter().acquire(KEY, { signal: controller.signal });
  await new Promise(resolve => setImmediate(resolve)); controller.abort();
  await assert.rejects(pending, e => e.reason === 'cancelled');
  assert.ok(remove.mock.callCount() > 0); assert.equal(db.rows.get(KEY), 50);
});

test('a delayed database response cannot dispatch a stale permit', async t => {
  const db = database(); let now = 0; t.mock.method(performance, 'now', () => now);
  db.state.afterClaim = () => { now = 1_001; };
  await assert.rejects(db.limiter().acquire(KEY), limited);
  assert.equal(db.rows.get(KEY), SYRVE_REQUEST_GAP_MS);
});

test('every auth, organization, catalog and section request uses the same quota', async t => {
  const admitted = [], noop = require('./helpers/syrve-test-request-limiter.js');
  const limiter = { acquire: async (key, controls) => { admitted.push(key); return noop.acquire(key, controls); }, cooldown: noop.cooldown };
  const { client, calls } = transport(t, limiter, url => {
    const path = new URL(url).pathname;
    return Response.json(path.endsWith('access_token') ? { token: 'synthetic-token' }
      : path.endsWith('organizations') ? { organizations: [{ id: ORG, name: 'MOLO' }] }
      : path.endsWith('terminal_groups') ? { terminalGroups: [{ organizationId: ORG, items: [{ id: GROUP, organizationId: ORG, name: 'Зал' }] }], terminalGroupsInSleep: [] }
      : { restaurantSections: [{ id: ORG, terminalGroupId: GROUP, name: 'Зал', tables: [{ id: TABLE, number: 1, name: 'Стіл', isDeleted: false }] }] });
  });
  const catalog = await client.getCatalog(BASE, LOGIN, ORG);
  assert.equal(calls.length, 4); assert.deepEqual(admitted, Array(4).fill(KEY));
  assert.ok(!JSON.stringify(catalog).includes(KEY));
});

test('real pacing keeps the 45-second probe safe but cannot complete its multi-request chain', async t => {
  const db = database();
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_000 });
  Object.defineProperty(db.state, 'now', { get: () => Date.now() - 1_000 });
  t.mock.method(performance, 'now', () => Date.now() - 1_000);
  const { client, calls } = transport(t, db.limiter(), url => Response.json(new URL(url).pathname.endsWith('access_token')
    ? { token: 'synthetic-token' } : { organizations: [{ id: ORG, name: 'MOLO' }] }));
  const pending = client.probeOrders(BASE, LOGIN, ORG, [TABLE], [], { deadline: 46_000 });
  while (!db.statements.some(q => q.sql.startsWith('SELECT '))) await new Promise(setImmediate);
  await new Promise(setImmediate);
  t.mock.timers.tick(31_000);
  const probe = await pending;
  assert.deepEqual(calls, ['/api/1/access_token', '/api/1/organizations']);
  assert.equal(probe.checks.connection.status, 'ok');
  assert.equal(probe.checks.terminalGroups.code, 'SYRVE_RATE_LIMITED');
  assert.equal(probe.byTable, null); assert.equal(probe.byId, null);
});

test('initialization rechecks settings after waiting and does not mark an unsent command started', async t => {
  const noop = require('./helpers/syrve-test-request-limiter.js'); let admitted = 0, started = 0, revoked = false;
  const limiter = { acquire: async (key, controls) => { if (++admitted === 3) revoked = true; return noop.acquire(key, controls); }, cooldown: noop.cooldown };
  const { client, calls } = transport(t, limiter, url => Response.json(new URL(url).pathname.endsWith('access_token')
    ? { token: 'synthetic-token' } : { organizations: [{ id: ORG, name: 'MOLO' }] }));
  const { ConflictException } = require('@nestjs/common');
  await assert.rejects(client.initializeTables(BASE, LOGIN, { organizationId: ORG, groups: [{ terminalGroupId: GROUP, posVersion: '7.7.1', tableIds: [TABLE] }] },
    { beforeCommand: async () => { if (revoked) throw new ConflictException('Налаштування змінилися'); }, commandStarted: () => started++ }), e => e.getStatus() === 409);
  assert.equal(started, 0); assert.equal(calls.length, 2);
});

test('slow local authorization does not age the HTTP permit or exceed the rolling quota', async t => {
  const { withSyrveOperation } = require('../dist/syrve/syrve-operation-context.js');
  const db = database();
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_000 });
  Object.defineProperty(db.state, 'now', { get: () => Date.now() - 1_000 });
  t.mock.method(performance, 'now', () => Date.now() - 1_000);
  const sentAt = [], checkedAt = [];
  const { client, calls } = transport(t, db.limiter(), url => {
    sentAt.push(Date.now());
    return Response.json(new URL(url).pathname.endsWith('/access_token')
      ? { token: 'synthetic-token' } : { organizations: [{ id: ORG, name: 'MOLO' }] });
  });
  let settled = false;
  const pending = withSyrveOperation({ deadline: 46_000, signal: new AbortController().signal,
    beforeRequest: async () => { t.mock.timers.tick(1_500); checkedAt.push(Date.now()); } },
  () => client.checkOrganizations(BASE, LOGIN));
  void pending.then(() => { settled = true; }, () => { settled = true; });
  for (let tick = 0; !settled && tick < 60; tick++) {
    await new Promise(setImmediate);
    if (!settled) t.mock.timers.tick(1_000);
  }
  const result = await pending;
  assert.equal(result.organizations.length, 1);
  assert.deepEqual(calls, ['/api/1/access_token', '/api/1/organizations']);
  assert.ok(sentAt.every(time => checkedAt.includes(time)));
  assert.ok(sentAt[1] - sentAt[0] >= SYRVE_REQUEST_GAP_MS);
});

test('revocation during quota waiting is rechecked before claiming another slot', async t => {
  const { withSyrveOperation } = require('../dist/syrve/syrve-operation-context.js');
  const { ConflictException } = require('@nestjs/common');
  const db = database();
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_000 });
  Object.defineProperty(db.state, 'now', { get: () => Date.now() - 1_000 });
  t.mock.method(performance, 'now', () => Date.now() - 1_000);
  const { client, calls } = transport(t, db.limiter());
  let revoked = false;
  const pending = withSyrveOperation({ deadline: 90_000, signal: new AbortController().signal,
    beforeRequest: async () => { if (revoked) throw new ConflictException('Налаштування змінилися'); } },
  () => client.checkOrganizations(BASE, LOGIN));
  const rejected = assert.rejects(pending, e => e.getStatus() === 409);
  while (!db.statements.some(q => q.sql.startsWith('SELECT '))) await new Promise(setImmediate);
  revoked = true; t.mock.timers.tick(SYRVE_REQUEST_GAP_MS);
  await rejected;
  assert.deepEqual(calls, ['/api/1/access_token']);
  assert.equal(db.rows.get(KEY), SYRVE_REQUEST_GAP_MS);
});

test('a 60-table long operation and concurrent Director check complete under the same real rolling quota', async t => {
  const { withSyrveOperation } = require('../dist/syrve/syrve-operation-context.js');
  const { isVerifiedLoadedProbe } = require('../dist/syrve/syrve-client.js');
  const { batchTransport } = require('./helpers/syrve-batch-transport.js');
  const { id } = require('./helpers/syrve-state-fixtures.js');
  const db = database(), tables = Array.from({ length: 60 }, (_, n) => id(100 + n)), tx = batchTransport(ORG, tables);
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_000 });
  Object.defineProperty(db.state, 'now', { get: () => Date.now() - 1_000 });
  t.mock.method(performance, 'now', () => Date.now() - 1_000);
  const dispatches = [];
  t.mock.method(globalThis, 'fetch', (url, options) => { dispatches.push(Date.now()); return tx.fetch(url, options); });
  for (const key of ['SYRVE_APP_ID', 'SYRVE_APP_CLIENT_SECRET']) {
    const before = process.env[key]; delete process.env[key];
    t.after(() => before === undefined ? delete process.env[key] : process.env[key] = before);
  }
  const controls = { deadline: 1_800_000, signal: new AbortController().signal, beforeCommand: async () => {}, loadingPlan: tx.plan };
  const client = new SyrveClient(db.limiter()); let settled = false;
  const pending = Promise.all([
    withSyrveOperation(controls, () => client.probeLoadedOrderBatch(BASE, LOGIN, ORG,
      tables.map(tableId => ({ tableId, orderIdBatches: [[]], visibilityContext: tableId })), controls)),
    withSyrveOperation(controls, () => new SyrveClient(db.limiter()).checkOrganizations(BASE, LOGIN)),
  ]);
  pending.then(() => settled = true, () => settled = true);
  for (let n = 0; n < 55 && !settled; n++) { await new Promise(setImmediate); if (!settled) t.mock.timers.tick(31_000); }
  const [probes, director] = await pending;
  assert.equal(probes.length, 60); assert.equal(director.organizations.length, 1);
  assert.equal(dispatches.length, 9); assert.ok(dispatches.at(-1) - dispatches[0] > 45_000);
  const warmStart = dispatches.length;
  settled = false;
  const warm = withSyrveOperation(controls, () => client.probeLoadedOrderBatch(BASE, LOGIN, ORG,
    tables.map(tableId => ({ tableId, orderIdBatches: [[]], visibilityContext: 'warm-' + tableId })), controls));
  warm.then(() => settled = true, () => settled = true);
  for (let n = 0; n < 25 && !settled; n++) { await new Promise(setImmediate); if (!settled) t.mock.timers.tick(31_000); }
  const warmed = await warm;
  assert.equal(dispatches.length - warmStart, 3);
  assert.equal(tx.calls.filter(call => call.path.endsWith('/init_by_table')).length, 2);
  for (const time of dispatches) assert.ok(dispatches.filter(value => value >= time && value < time + 60_000).length <= 2);
  for (const [index, value] of probes.entries()) assert.equal(isVerifiedLoadedProbe(value[0], tables[index], ORG, tables[index]), true);
  for (const [index, value] of warmed.entries()) {
    assert.equal(isVerifiedLoadedProbe(value[0], 'warm-' + tables[index], ORG, tables[index]), true);
    assert.equal(isVerifiedLoadedProbe(value[0], tables[index], ORG, tables[index]), false);
  }
});

test('quota migration rollback refuses a live cooldown and requires a transaction', async () => {
  const migration = new Migration();
  await assert.rejects(migration.down({ isTransactionActive: false }), /active transaction/);
  await assert.rejects(migration.down({ isTransactionActive: true, query: async sql => sql.startsWith('SELECT ') ? [{ active: true }] : [] }), /live Syrve quota/);
});

test('a quota storage outage uses an existing durable worker error without changing its frozen schema', () => {
  const { workerError } = require('../dist/syrve/syrve-worker.model.js');
  assert.equal(workerError('SYRVE_RATE_GUARD_UNAVAILABLE'), 'SYRVE_UNAVAILABLE');
});

test('PostgreSQL validation refuses unverified and remote targets before connecting', async () => {
  const { runSyrveRequestLimitValidation } = await import('../scripts/syrve-request-limit-validation.mjs');
  await assert.rejects(runSyrveRequestLimitValidation({}), /disabled/);
  await assert.rejects(runSyrveRequestLimitValidation({ FRESH_SCHEMA_REFERENCE_ALLOW: 'true', DB_HOST: 'remote.neon.tech', DB_NAME: 'molo_fresh_schema_reference', DB_SYNCHRONIZE: 'true' }), /localhost/);
});
