const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const path = require('node:path');
const ID = 'a0000000-0000-4000-8000-000000000001';
function fixture(progress) {
  let now = 0, starts = 0, reads = 0; const waits = [];
  const api = { post: async () => { starts++; return { operationId: ID, status: 'running', pollAfterMs: 15000 }; },
    get: async url => { assert.equal(url, '/syrve-integration/operations/' + ID); const item = progress[reads++]; if (item instanceof Error) throw item; return { operationId: ID, pollAfterMs: 15000, ...item }; } };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '../src/api/syrveOperation.ts'), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports,
    require: name => { assert.equal(name, './client'); return { api }; }, performance: { now: () => now },
    setTimeout: (resolve, delay) => { waits.push(delay); now += delay; queueMicrotask(resolve); } });
  return { run: () => exports.syrveOperation('/syrve-integration/test', { apiLogin: 'synthetic' }), stats: () => ({ starts, reads, waits }) };
}
test('long checks poll MOLO at 15 seconds and submit the Syrve action exactly once', async () => {
  const h = fixture([{ status: 'running' }, { status: 'running' }, { status: 'done', result: { syncEnabled: false } }]);
  assert.equal((await h.run()).syncEnabled, false); assert.deepEqual(h.stats(), { starts: 1, reads: 3, waits: [15000, 15000, 15000] });
});
test('temporary progress failures do not restart the submitted operation', async () => {
  const h = fixture([new Error('network'), { status: 'done', result: { connected: true } }]);
  assert.equal((await h.run()).connected, true); assert.equal(h.stats().starts, 1);
});
test('failed, foreign and malformed progress cannot report success', async () => {
  await assert.rejects(fixture([{ status: 'failed', error: { message: 'Перевірку перервано' } }]).run(), /Перевірку перервано/);
  await assert.rejects(fixture([{ status: 'done', operationId: 'foreign', result: {} }]).run(), /Недійсний/);
  await assert.rejects(fixture([{ status: 'unexpected', result: {} }]).run(), /Недійсний/);
});
