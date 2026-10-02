const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const VERSION = 'd0000000-0000-4000-8000-000000000001', OTHER = 'd0000000-0000-4000-8000-000000000002';
const ORG = 'a0000000-0000-4000-8000-000000000001';
function report(version = VERSION) {
  return { configurationRevision: version, organizationId: ORG,
    startedAt: '2026-10-02T07:00:00Z', checkedAt: '2026-10-02T07:00:01Z',
    checks: ['connection', 'terminalGroups', 'restaurantSections', 'posAvailability', 'ordersByTable', 'ordersById']
      .map(key => ({ key, status: key === 'ordersById' ? 'not_checked' : 'ok', code: null })),
    summary: { linkedTables: 2, tablesWithOpenOrders: 1, unknownTables: 1, observedOrders: 2,
      openOrders: 1, explicitlyClosedOrders: 1, unknownOrders: 0, unresolvedKnownOrders: 0,
      terminalGroups: { alive: 1, sleeping: 0, offline: 0, unknown: 0 } },
    diagnostics: { complete: false, posOrderVisibility: 'not_verified', posVersion: 'not_verified', initializationPerformed: false },
    syncEnabled: false, activationAvailable: false, statusesApplied: false, renamingApplied: false };
}
function load(deps = {}) {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/director/SyrveOrderDiagnosticsPanel.tsx'), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  vm.runInNewContext(js, { exports, require: name => name === '../api/syrve' ? { syrveApi: deps.api || {} }
    : name === 'react' ? deps.react || React : require(name) });
  return exports;
}
const scope = version => ({ configurationRevision: version || VERSION, organizationId: ORG, linkedTables: 2 });
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function button(node) {
  if (!node || typeof node !== 'object') return null;
  if (node.type === 'button') return node;
  for (const child of [node.props?.children].flat(Infinity)) { const found = button(child); if (found) return found; }
  return null;
}
function mounted(api) {
  const states = [], refs = [], effects = []; let stateIndex = 0, refIndex = 0, previous, cleanup;
  let props = { ...scope(), connectionReady: true, busy: false };
  const component = load({ api, react: {
    useState(value) { const position = stateIndex++; if (!(position in states)) states[position] = value;
      return [states[position], value => { states[position] = typeof value === 'function' ? value(states[position]) : value; }]; },
    useRef(value) { const position = refIndex++; if (!(position in refs)) refs[position] = { current: value }; return refs[position]; },
    useEffect(effect, deps) { if (JSON.stringify(previous) !== JSON.stringify(deps)) { previous = deps; effects.push(effect); } },
  } }).default;
  const render = changes => {
    props = { ...props, ...changes }; stateIndex = 0; refIndex = 0;
    const tree = component(props);
    while (effects.length) { cleanup?.(); cleanup = effects.shift()(); }
    return tree;
  };
  return { states, render, click: () => button(render()).props.onClick(), unmount: () => cleanup?.() };
}

test('the actual API adapter sends only saved configuration revision to the Director diagnostics route', async () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/api/syrve.ts'), 'utf8');
  const exports = {}; let request;
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    { exports, require: () => ({ api: { post: async (url, payload) => { request = { url, payload }; return report(); } } }) });
  await exports.syrveApi.orderDiagnostics(VERSION);
  assert.deepEqual(JSON.parse(JSON.stringify(request)), { url: '/syrve-integration/orders-diagnostics', payload: { configurationRevision: VERSION } });
});

test('mounting or refreshing saved settings never automatically queries Syrve orders', async () => {
  let calls = 0; const h = mounted({ orderDiagnostics: async () => { calls++; return report(); } });
  h.render(); await flush(); h.render({ configurationRevision: OTHER }); await flush();
  assert.equal(calls, 0); assert.equal(h.states[0], null);
});

test('only an explicit click queries orders and duplicate clicks share one in-flight request', async () => {
  const response = deferred(); let calls = 0;
  const h = mounted({ orderDiagnostics: version => { assert.equal(version, VERSION); calls++; return response.promise; } });
  h.click(); h.click(); assert.equal(calls, 1); assert.equal(h.states[1], true);
  response.resolve(report()); await flush();
  assert.equal(h.states[0].configurationRevision, VERSION); assert.equal(h.states[1], false);
});

test('unprepared connection, no confirmed mappings and parent operations block the order request', async () => {
  for (const change of [{ connectionReady: false }, { linkedTables: 0 }, { busy: true },
    { configurationRevision: null }, { organizationId: null }, { configurationRevision: 'invalid' }]) {
    let calls = 0; const h = mounted({ orderDiagnostics: async () => { calls++; return report(); } });
    const tree = h.render(change); assert.equal(button(tree).props.disabled, true);
    button(tree).props.onClick(); await flush(); assert.equal(calls, 0);
  }
});

test('closing the panel while a request is pending discards its eventual success', async () => {
  const response = deferred(); const h = mounted({ orderDiagnostics: () => response.promise });
  h.click(); h.unmount(); const before = JSON.stringify(h.states);
  response.resolve(report()); await flush(); assert.equal(JSON.stringify(h.states), before);
});

test('a new configuration cannot accept the older request or let it overwrite a new result', async () => {
  const first = deferred(), second = deferred(); let calls = 0;
  const h = mounted({ orderDiagnostics: () => ++calls === 1 ? first.promise : second.promise });
  h.click(); h.render({ configurationRevision: OTHER }); h.click();
  second.resolve(report(OTHER)); await flush(); first.resolve(report()); await flush();
  assert.equal(h.states[0].configurationRevision, OTHER); assert.equal(h.states[1], false);
});

test('a report is hidden immediately after scope changes, before the clearing effect runs', async () => {
  const h = mounted({ orderDiagnostics: async () => report() }); h.click(); await flush();
  assert.match(renderToStaticMarkup(h.render()), /Доступ до ресторану · доступ підтверджено/);
  for (const change of [{ organizationId: OTHER }, { linkedTables: 3 }, { connectionReady: false }, { busy: true }]) {
    const html = renderToStaticMarkup(h.render(change));
    assert.doesNotMatch(html, /Доступ до ресторану · доступ підтверджено/);
  }
});

test('parent recheck cancels old results even when it temporarily keeps the same revision', async () => {
  const response = deferred(); const h = mounted({ orderDiagnostics: () => response.promise });
  h.click(); h.render({ busy: true }); h.render({ busy: false });
  response.resolve(report()); await flush(); assert.equal(h.states[0], null); assert.equal(h.states[1], false);
});

test('retry clears old success and renders a fixed failure without HTTP error details', async () => {
  let failed = false; const h = mounted({ orderDiagnostics: async () => { if (failed) throw new Error('secret-token-and-upstream-body'); return report(); } });
  h.click(); await flush(); assert.ok(h.states[0]); failed = true;
  h.click(); assert.equal(h.states[0], null); await flush();
  const html = renderToStaticMarkup(h.render());
  assert.match(html, /Перевірку не завершено/); assert.doesNotMatch(html, /secret-token|Доступ до ресторану · доступ підтверджено/);
});

test('malformed, inconsistent or activation-like responses cannot become successful diagnostics', () => {
  const { validateOrderDiagnostics } = load();
  const mutations = [r => r.syncEnabled = true, r => r.activationAvailable = true, r => r.statusesApplied = true,
    r => r.renamingApplied = true, r => r.diagnostics.complete = true, r => r.diagnostics.initializationPerformed = true,
    r => r.diagnostics.posOrderVisibility = 'verified', r => r.diagnostics.posVersion = 'verified',
    r => r.configurationRevision = OTHER, r => r.organizationId = OTHER, r => r.startedAt = 'invalid',
    r => r.checkedAt = '2026-10-01T00:00:00Z', r => r.checks.pop(), r => r.checks[0] = r.checks[1],
    r => r.checks[0].key = 'constructor', r => r.checks[0].status = 'unexpected',
    r => r.checks[0].code = 'secret-error', r => Object.assign(r.checks[0], { status: 'error', code: 'secret-error' }),
    r => r.summary.linkedTables = 3, r => r.summary.unknownTables = -1, r => r.summary.openOrders = 1.5,
    r => r.summary.terminalGroups.alive = NaN, r => r.summary.unknownTables = 0,
    r => r.summary.observedOrders = 10, r => Object.assign(r.checks[4], { status: 'error', code: 'SYRVE_ACCESS_DENIED' })];
  for (const mutate of mutations) { const value = report(); mutate(value); assert.throws(() => validateOrderDiagnostics(value, scope()), /Недійсний/); }
});

test('a response for another saved scope is rejected by the mounted request handler', async () => {
  const h = mounted({ orderDiagnostics: async () => report(OTHER) }); h.click(); await flush();
  assert.equal(h.states[0], null); assert.equal(h.states[2], true);
});

test('unknown payload properties are not retained and the view never exposes identifiers or activation controls', () => {
  const { validateOrderDiagnostics, SyrveOrderDiagnosticsView } = load();
  const input = report(); input.privatePayload = 'secret-credential'; input.checks[0].upstreamBody = 'secret-credential';
  input.summary.customer = 'secret-credential'; input.diagnostics.token = 'secret-credential';
  const checked = validateOrderDiagnostics(input, scope()); assert.ok(!JSON.stringify(checked).includes('secret-credential'));
  const html = renderToStaticMarkup(React.createElement(SyrveOrderDiagnosticsView, { report: checked }));
  for (const text of ['Замовлення за столами', 'Явно закриті замовлення', 'Порожня відповідь', 'не підтверджує вільний стіл', 'Синхронізація залишається вимкненою']) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /secret-credential|<button|configurationRevision|apiLogin|orderIds/);
  assert.ok(!html.includes(VERSION)); assert.ok(!html.includes(ORG));
});

test('permission failure and sleeping or offline registers retain unknown tables and no positive closure', () => {
  const { validateOrderDiagnostics, SyrveOrderDiagnosticsView } = load();
  const value = report(); Object.assign(value.checks[4], { status: 'error', code: 'SYRVE_ACCESS_DENIED' });
  Object.assign(value.summary, { tablesWithOpenOrders: 0, unknownTables: 2, observedOrders: 0, openOrders: 0, explicitlyClosedOrders: 0 });
  value.summary.terminalGroups = { alive: 0, sleeping: 1, offline: 1, unknown: 0 };
  const checked = validateOrderDiagnostics(value, scope());
  const html = renderToStaticMarkup(React.createElement(SyrveOrderDiagnosticsView, { report: checked }));
  assert.match(html, /Syrve не надав потрібного дозволу/); assert.match(html, /Сплячі касові групи: 1/);
  assert.match(html, /Недоступні: 1/); assert.equal(checked.summary.unknownTables, 2);
});
