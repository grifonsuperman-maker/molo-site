const assert = require('node:assert/strict'), test = require('node:test'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const React = require('react');
const REV = 'a0000000-0000-4000-8000-000000000001', NEXT = 'a0000000-0000-4000-8000-000000000002', ORG = 'a0000000-0000-4000-8000-000000000003';
const pairs = [{ moloTableId: REV, syrveTableId: NEXT }];
const preview = () => ({ configurationRevision: REV, organization: { id: ORG, name: 'MOLO' }, checkedAt: '2026-10-06T12:00:00.000Z',
  confirmation: { proof: 'synthetic-opaque-proof', expiresAt: '2026-10-06T12:05:00.000Z' }, proposals: pairs,
  missingInSyrve: [{ id: NEXT, tableNumber: '108' }] });
const result = () => ({ confirmedPairs: 1, integration: { organizationId: ORG, configurationRevision: NEXT, syncEnabled: false } });
function moduleAt(file, requireFn, globals = {}) {
  const exports = {}, source = fs.readFileSync(path.resolve(__dirname, '../src/' + file), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText,
    { exports, require: requireFn || require, performance, Date, ...globals }); return exports;
}
function find(node, predicate) {
  if (!node || typeof node !== 'object') return null; if (predicate(node)) return node;
  for (const child of [node.props?.children].flat(Infinity)) { const found = find(child, predicate); if (found) return found; } return null;
}
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function deferred() { let resolve; const promise = new Promise(yes => resolve = yes); return { promise, resolve }; }
function mounted(api, changes = {}, clock = { now: () => 1000 }) {
  const states = [], refs = []; let si = 0, ri = 0, previous, cleanup, effect;
  let props = { configurationRevision: REV, organizationId: ORG, linkedTables: 36, syncEnabled: false, busy: false,
    onBusyChange: () => {}, onConfirmed: async () => {}, ...changes };
  const hooks = { useState(value) { const i = si++; if (!(i in states)) states[i] = value; return [states[i], value => states[i] = value]; },
    useRef(value) { const i = ri++; if (!(i in refs)) refs[i] = { current: value }; return refs[i]; },
    useEffect(action, deps) { if (JSON.stringify(previous) !== JSON.stringify(deps)) { previous = deps; effect = action; } } };
  const component = moduleAt('director/SyrveSavedTablesPanel.tsx', name => name === 'react' ? hooks : name === '../api/syrve' ? { syrveApi: api }
    : name === './SyrveCatalogPreviewPanel' ? { default: () => null }
    : name === './services/syrveOperationErrors' ? moduleAt('director/services/syrveOperationErrors.ts')
    : name === './services/syrveConfirmationTime' ? moduleAt('director/services/syrveConfirmationTime.ts', null, { performance: clock }) : require(name), { performance: clock }).default;
  const render = changes => { props = { ...props, ...changes }; si = 0; ri = 0; const tree = component(props);
    if (effect) { cleanup?.(); const action = effect; effect = null; cleanup = action(); } return tree; };
  const click = label => { const button = find(render(), node => node.type === 'button' && node.props.children === label); assert.ok(button, label); button.props.onClick(); };
  return { render, states, ready: () => render(), check: () => click('Перевірити список столів Syrve'),
    confirm: () => click('Додати підтверджені зв’язки'), ack: () => find(render(), node => node.type === 'input').props.onChange({ target: { checked: true } }),
    unmount: () => cleanup?.() };
}

test('saved catalogue API sends no API key, only the current revision and reviewed UUID pairs', async () => {
  const calls = [], api = moduleAt('api/syrve.ts', () => ({ api: { post: (url, body) => { calls.push({ url, body }); } } })).syrveApi;
  await api.previewSavedTables(REV); await api.confirmSavedTables(REV, 'proof', pairs);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    { url: '/syrve-integration/saved-tables-preview', body: { configurationRevision: REV } },
    { url: '/syrve-integration/confirm-saved-tables', body: { configurationRevision: REV, confirmationProof: 'proof', pairs, confirmed: true } },
  ]);
});

test('catalogue reading is manual and available with autosync on; link writes stay blocked', async () => {
  let reads = 0, writes = 0;
  const h = mounted({ previewSavedTables: async () => { reads++; return preview(); }, confirmSavedTables: async () => writes++ }, { syncEnabled: true });
  h.ready(); await flush(); assert.equal(reads, 0);
  h.check(); await flush(); assert.equal(reads, 1); assert.equal(writes, 0);
  assert.ok(h.states[0]); assert.equal(find(h.render(), node => node.type === 'input'), null);
  assert.ok(find(h.render(), node => typeof node.props?.children === 'string' && /спочатку вимкніть автостатуси/.test(node.props.children)));
});

test('adding missing links requires fresh review and acknowledgement; double submission is excluded', async () => {
  const pending = deferred(), refresh = deferred(), busy = []; let writes = 0, refreshed = 0;
  const h = mounted({ previewSavedTables: async () => preview(), confirmSavedTables: (revision, proof, selected) => {
    assert.equal(revision, REV); assert.equal(proof, preview().confirmation.proof);
    assert.deepEqual(JSON.parse(JSON.stringify(selected)), pairs); writes++; return pending.promise;
  } }, { onBusyChange: working => busy.push(working), onConfirmed: async () => { refreshed++; await refresh.promise; } });
  h.ready(); h.check(); await flush(); h.confirm(); assert.equal(writes, 0);
  h.ack(); h.confirm(); h.confirm(); assert.equal(writes, 1); assert.equal(busy.at(-1), true);
  pending.resolve(result()); await flush(); assert.equal(refreshed, 1); assert.equal(h.states[1], true);
  refresh.resolve(); await flush(); assert.equal(h.states[0], null); assert.equal(busy.at(-1), false);
});

test('device wall-clock changes do not invalidate server time, but elapsed confirmation time does', async () => {
  let tick = 1000, writes = 0;
  const h = mounted({ previewSavedTables: async () => preview(), confirmSavedTables: async () => { writes++; return result(); } }, {}, { now: () => tick });
  h.ready(); h.check(); await flush(); h.ack(); tick += 300000; h.confirm(); await flush();
  assert.equal(writes, 0); assert.equal(h.states[0], null);
});

test('late responses after closing, changing restaurant or changing revision cannot restore stale proposals', async () => {
  for (const change of [null, { configurationRevision: NEXT }, { organizationId: NEXT }, { syncEnabled: true }]) {
    const pending = deferred(); let writes = 0;
    const h = mounted({ previewSavedTables: () => pending.promise, confirmSavedTables: async () => writes++ });
    h.ready(); h.check(); change ? h.render(change) : h.unmount(); pending.resolve(preview()); await flush();
    assert.equal(h.states[0], null); assert.equal(writes, 0);
  }
});

test('transport loss consumes the preview and exposes a fixed message without provider details', async () => {
  const h = mounted({ previewSavedTables: async () => preview(), confirmSavedTables: async () => { throw new Error('private-key provider-body'); } });
  h.ready(); h.check(); await flush(); h.ack(); h.confirm(); await flush();
  assert.equal(h.states[0], null); assert.equal(h.states[2], false);
  const alert = find(h.render(), node => node.props?.role === 'alert');
  assert.match(alert.props.children, /Збереження зв’язків не підтверджено/); assert.doesNotMatch(alert.props.children, /private-key|provider-body/);
});
