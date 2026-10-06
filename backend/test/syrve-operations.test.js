const assert = require('node:assert/strict');
const test = require('node:test');
const { ConflictException } = require('@nestjs/common');
const { SyrveOperationsService } = require('../dist/syrve/syrve-operations.service.js');
const { currentSyrveOperation, withSyrveOperation, SYRVE_OPERATION_BUDGET_MS } = require('../dist/syrve/syrve-operation-context.js');
const actor = { sub: 'synthetic-director', role: 'owner', directorSessionVersion: 3 };
const flush = () => new Promise(setImmediate);
function fixture() {
  const rows = new Map(), calls = [];
  const source = { options: { type: 'postgres' }, query: async (sql, p) => {
    calls.push({ sql, p });
    if (sql.startsWith('DELETE')) return [[], 0];
    if (sql.startsWith('INSERT')) {
      if ([...rows.values()].some(row => row.owner === p[1] && row.status === 'running')) throw Object.assign(new Error(), { code: '23505' });
      rows.set(p[0], { id: p[0], owner: p[1], runner: p[2], status: 'running', result: null, error: null, live: true }); return [];
    }
    if (sql.includes('SET status=\'failed\'')) { for (const row of rows.values()) if (row.owner === p[0] && !row.live) { row.status = 'failed'; row.error = JSON.parse(p[1]); } return [[], 0]; }
    const row = rows.get(p[0]);
    const own = row && row.owner === p[1];
    if (sql.startsWith('SELECT status')) return own ? [row] : [];
    const live = own && row.runner === p[2] && row.live && row.status === 'running';
    if (sql.startsWith('SELECT id')) return live ? [{ id: row.id }] : [];
    if (sql.includes('SET live_until')) return live ? [[{ id: row.id }], 1] : [[], 0];
    if (sql.includes('SET status=$4')) { if (live) Object.assign(row, { status: p[3], result: JSON.parse(p[4]), error: JSON.parse(p[5]) }); return [live ? [{ id: row.id }] : [], live ? 1 : 0]; }
    assert.fail(sql);
  } };
  return { service: new SyrveOperationsService(source), rows, calls };
}
test('Director receives a durable operation ID before its quota-paced action finishes', async () => {
  const h = fixture(); let finish;
  const blocked = new Promise(resolve => finish = resolve);
  const started = await h.service.start(actor, 'test', () => blocked, async () => actor);
  assert.equal(started.status, 'running');
  assert.equal((await h.service.read(started.operationId, actor)).status, 'running');
  finish({ organizations: [], syncEnabled: false }); await flush();
  const result = await h.service.read(started.operationId, actor);
  assert.equal(result.status, 'done'); assert.equal(result.result.syncEnabled, false);
  await h.service.onApplicationShutdown();
});
test('operation results are inaccessible to other Directors, rotated sessions and staff roles', async () => {
  const h = fixture(); const started = await h.service.start(actor, 'test', async () => ({ proof: 'private-proof' }), async () => actor); await flush();
  for (const other of [{ ...actor, sub: 'other' }, { ...actor, directorSessionVersion: 4 }]) await assert.rejects(h.service.read(started.operationId, other), e => e.getStatus() === 404);
  for (const role of ['guest', 'waiter', 'hookah', 'admin']) await assert.rejects(h.service.read(started.operationId, { ...actor, role }), e => e.getStatus() === 409);
  assert.ok(!JSON.stringify(h.calls).includes(actor.sub)); await h.service.onApplicationShutdown();
});
test('one Director cannot enqueue duplicate work from two phones', async () => {
  const h = fixture(); let finish; const blocked = new Promise(resolve => finish = resolve);
  await h.service.start(actor, 'test', () => blocked, async () => actor);
  await assert.rejects(h.service.start(actor, 'connect', async () => assert.fail(), async () => actor), e => e.getStatus() === 409);
  finish({}); await flush(); await h.service.onApplicationShutdown();
});
test('a crashed or expired operation returns an interruption instead of old success', async () => {
  const h = fixture(); let finish; const blocked = new Promise(resolve => finish = resolve);
  const started = await h.service.start(actor, 'test', () => blocked, async () => actor);
  h.rows.get(started.operationId).live = false;
  assert.equal((await h.service.read(started.operationId, actor)).status, 'failed');
  finish({ success: true }); await flush();
  assert.equal((await h.service.read(started.operationId, actor)).result, null); await h.service.onApplicationShutdown();
});
test('unexpected exceptions are sanitized and missing preparation executes no action', async () => {
  const h = fixture(); const started = await h.service.start(actor, 'test', async () => { throw new Error('private-api-login-and-token'); }, async () => actor); await flush();
  const result = await h.service.read(started.operationId, actor);
  assert.equal(result.status, 'failed'); assert.ok(!JSON.stringify(result).includes('private-api-login'));
  const unavailable = new SyrveOperationsService({ options: { type: 'postgres' }, query: async () => { throw new Error('private-db'); } });
  await assert.rejects(unavailable.start(actor, 'test', async () => assert.fail(), async () => actor), e => e.getStatus() === 503);
  await h.service.onApplicationShutdown();
});
test('credential rotation is rechecked before every request after quota waiting', async () => {
  const h = fixture(); let revoked = false, sends = 0;
  const started = await h.service.start(actor, 'test', async () => {
    await currentSyrveOperation().beforeRequest(); sends++;
    revoked = true; await currentSyrveOperation().beforeRequest(); sends++;
  }, async () => { if (revoked) throw new ConflictException('Недійсний вхід Директора'); }); await flush();
  assert.equal(sends, 1); assert.equal((await h.service.read(started.operationId, actor)).status, 'failed');
  await h.service.onApplicationShutdown();
});
test('concurrent operation contexts keep their signals and deadlines separate', async () => {
  const a = new AbortController(), b = new AbortController();
  const values = await Promise.all([10, 20].map((deadline, index) => withSyrveOperation({ deadline, signal: index ? b.signal : a.signal }, async () => { await flush(); return currentSyrveOperation().deadline; })));
  assert.deepEqual(values, [10, 20]); assert.equal(currentSyrveOperation(), undefined);
  assert.equal(SYRVE_OPERATION_BUDGET_MS, 1_800_000);
});
