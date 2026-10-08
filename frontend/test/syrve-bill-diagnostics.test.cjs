const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const VERSION = 'f0000000-0000-4000-8000-000000000001';
const OTHER = 'f0000000-0000-4000-8000-000000000002';
const ORG = 'a0000000-0000-4000-8000-000000000001';
const POS = 'b0000000-0000-4000-8000-000000000001';
const CLOUD = 'c0000000-0000-4000-8000-000000000001';
const TABLE = 'd0000000-0000-4000-8000-000000000001';
const scope = () => ({ configurationRevision: VERSION, organizationId: ORG, requestedId: POS });
function report() {
  return { ...scope(), startedAt: '2026-10-08T07:00:00Z', checkedAt: '2026-10-08T07:00:01Z',
    lookup: 'posId', found: true, statusesApplied: false, bindingsApplied: false,
    order: { id: CLOUD, posId: POS, timestamp: 1, creationStatus: 'Success', number: 42,
      status: 'New', terminalGroupId: OTHER, tables: [{ syrveTableId: TABLE, moloTableNumber: '8' }] } };
}
function load(deps = {}) {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/director/SyrveBillDiagnosticsPanel.tsx'), 'utf8');
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText,
    { exports, require: name => name === '../api/syrve' ? { syrveApi: deps.api || {} }
      : name === 'react' ? deps.react || React : require(name) });
  return exports;
}
function find(node, type) {
  if (!node || typeof node !== 'object') return null;
  if (node.type === type) return node;
  for (const child of [node.props?.children].flat(Infinity)) { const found = find(child, type); if (found) return found; }
  return null;
}
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function deferred() { let resolve; const promise = new Promise(yes => resolve = yes); return { promise, resolve }; }
function mounted(api) {
  const states = [], refs = [], effects = []; let stateIndex = 0, refIndex = 0, previous, cleanup;
  let props = { configurationRevision: VERSION, organizationId: ORG, connectionReady: true, busy: false };
  const component = load({ api, react: {
    useState(value) { const i = stateIndex++; if (!(i in states)) states[i] = value;
      return [states[i], value => states[i] = typeof value === 'function' ? value(states[i]) : value]; },
    useRef(value) { const i = refIndex++; if (!(i in refs)) refs[i] = { current: value }; return refs[i]; },
    useEffect(effect, deps) { if (JSON.stringify(previous) !== JSON.stringify(deps)) { previous = deps; effects.push(effect); } },
  } }).default;
  const render = changes => {
    props = { ...props, ...changes }; stateIndex = 0; refIndex = 0; const tree = component(props);
    while (effects.length) { cleanup?.(); cleanup = effects.shift()(); }
    return tree;
  };
  return { states, render, input: value => { find(render(), 'input').props.onChange({ target: { value } }); render(); },
    click: () => find(render(), 'button').props.onClick(), unmount: () => cleanup?.() };
}

test('API adapter sends only the saved revision and bill UUID through existing async operation polling', async () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/api/syrve.ts'), 'utf8');
  const exports = {}; let request;
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    { exports, require: require('./helpers/syrve-operation-fixture.cjs').resolver({ post: async (url, payload) => { request = { url, payload }; return report(); } }) });
  await exports.syrveApi.billDiagnostics(VERSION, POS);
  assert.deepEqual(JSON.parse(JSON.stringify(request)), { url: '/syrve-integration/bill-diagnostics', payload: { configurationRevision: VERSION, orderId: POS } });
});

test('mounting and entering a UUID send no provider request; an explicit click suppresses duplicates', async () => {
  let calls = 0; const response = deferred();
  const h = mounted({ billDiagnostics: (version, id) => {
    assert.equal(version, VERSION); assert.equal(id, POS); calls++; return response.promise;
  } });
  h.render(); h.input(` ${POS.toUpperCase()} `); await flush(); assert.equal(calls, 0);
  h.click(); h.click(); assert.equal(calls, 1); assert.equal(h.states[2], true);
  response.resolve(report()); await flush(); assert.equal(h.states[1].order.number, 42); assert.equal(h.states[2], false);
});

test('invalid UUIDs, unavailable settings and sibling operations cannot submit a lookup', async () => {
  for (const change of [{ connectionReady: false }, { busy: true }, { configurationRevision: null }, { organizationId: null }]) {
    let calls = 0; const h = mounted({ billDiagnostics: async () => { calls++; return report(); } });
    h.input(POS); const tree = h.render(change); assert.equal(find(tree, 'button').props.disabled, true);
    h.click(); await flush(); assert.equal(calls, 0);
  }
  const h = mounted({ billDiagnostics: () => assert.fail('invalid identifier must not submit') });
  for (const value of ['', '53389', 'https://example.test/bill']) { h.input(value); h.click(); }
});

test('changing the requested bill or saved revision hides results and discards delayed success', async () => {
  for (const change of [{ configurationRevision: OTHER }, { organizationId: OTHER }, { busy: true }, { connectionReady: false }]) {
    const response = deferred(); const h = mounted({ billDiagnostics: () => response.promise });
    h.input(POS); h.click(); h.render(change); response.resolve(report()); await flush(); assert.equal(h.states[1], null);
  }
  const response = deferred(); const h = mounted({ billDiagnostics: () => response.promise });
  h.input(POS); h.click(); h.input(CLOUD); response.resolve(report()); await flush(); assert.equal(h.states[1], null);
});

test('unmounting discards a pending report and failures display no upstream error text', async () => {
  const response = deferred(); const h = mounted({ billDiagnostics: () => response.promise });
  h.input(POS); h.click(); h.unmount(); const before = JSON.stringify(h.states);
  response.resolve(report()); await flush(); assert.equal(JSON.stringify(h.states), before);
  const failed = mounted({ billDiagnostics: async () => { throw new Error('private-provider-body'); } });
  failed.input(POS); failed.click(); await flush(); const html = renderToStaticMarkup(failed.render());
  assert.match(html, /Перевірку не завершено/); assert.doesNotMatch(html, /private-provider-body/);
});

test('reports with other identities, malformed fields or applied statuses cannot be displayed', () => {
  const { validateBillDiagnostics } = load();
  for (const mutate of [r => r.configurationRevision = OTHER, r => r.organizationId = OTHER,
    r => r.requestedId = OTHER, r => r.order.posId = OTHER, r => r.lookup = 'other',
    r => r.found = false, r => r.statusesApplied = true, r => r.bindingsApplied = true,
    r => r.order.timestamp = -1, r => r.order.number = '42', r => r.order.status = 'other',
    r => r.order.tables.push(r.order.tables[0]), r => r.order.tables[0].syrveTableId = '8',
    r => r.order.tables[0].moloTableNumber = 8, r => r.checkedAt = 'invalid',
    r => r.order.creationStatus = 'Error', r => r.order.terminalGroupId = null]) {
    const value = report(); mutate(value); assert.throws(() => validateBillDiagnostics(value, scope()), /Недійсний/);
  }
});

test('whitelisted report shows exact UUID bindings and omits customer data and activation controls', () => {
  const { validateBillDiagnostics, SyrveBillDiagnosticsView } = load();
  const value = report(); value.privatePayload = 'private-body'; value.order.items = ['private-item'];
  value.order.tables[0].customer = 'private-guest';
  const checked = validateBillDiagnostics(value, scope()); assert.doesNotMatch(JSON.stringify(checked), /private-/);
  const html = renderToStaticMarkup(React.createElement(SyrveBillDiagnosticsView, { report: checked }));
  assert.match(html, /Рахунок №42/); assert.match(html, /Пов’язаний стіл MOLO: 8/); assert.ok(html.includes(TABLE));
  assert.match(html, /Статуси столів та зв’язки не змінено/); assert.doesNotMatch(html, /private-|<button/);
});

test('missing bills, unlinked tables and incomplete wrappers never claim a table is free', () => {
  const { validateBillDiagnostics, SyrveBillDiagnosticsView } = load();
  const missing = { ...report(), found: false, lookup: null, order: null };
  let html = renderToStaticMarkup(React.createElement(SyrveBillDiagnosticsView, { report: validateBillDiagnostics(missing, scope()) }));
  assert.match(html, /Рахунок не знайдено/); assert.match(html, /не підтверджує закриття/);
  const value = report(); value.order.tables[0].moloTableNumber = null;
  html = renderToStaticMarkup(React.createElement(SyrveBillDiagnosticsView, { report: validateBillDiagnostics(value, scope()) }));
  assert.match(html, /не має однозначного зв’язку/); assert.doesNotMatch(html, /Вільний/);
  for (const creationStatus of ['Error', 'InProgress']) {
    const value = report(); Object.assign(value.order, { creationStatus, status: null, number: null, terminalGroupId: null, tables: [] });
    assert.equal(validateBillDiagnostics(value, scope()).order.creationStatus, creationStatus);
  }
});
