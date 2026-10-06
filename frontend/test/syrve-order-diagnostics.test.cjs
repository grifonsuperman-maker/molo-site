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
    summary: { linkedTables: 2, tablesWithOccupancy: 1, unknownTables: 1,
      terminalGroups: { alive: 1, sleeping: 0, offline: 0, unknown: 0 } },
    posVersions: { read: { supported: 0, unsupported: 0, unknown: 2 },
      initialization: { supported: 0, unsupported: 0, unknown: 2 } },
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

function find(node, predicate) {
  if (!node || typeof node !== 'object') return null;
  if (predicate(node)) return node;
  for (const child of [node.props?.children].flat(Infinity)) { const match = find(child, predicate); if (match) return match; }
  return null;
}
function text(node) {
  if (typeof node === 'string') return node;
  return node && typeof node === 'object' ? [node.props?.children].flat(Infinity).map(text).join('') : '';
}
function dock() {
  const saved = { ...scope(), id: ORG, displayName: 'Збережене підключення', apiBaseUrl: 'https://api-eu.syrve.live',
    apiLoginMasked: '••••', hasCredentials: true, organizationName: 'Збережений ресторан', status: 'connected',
    settingsPrepared: true, confirmedLinks: 2, syncEnabled: false, lastCheckedAt: null, connectedAt: null, lastError: null };
  const api = { getStatus: async () => saved, test: async () => ({ apiBaseUrl: saved.apiBaseUrl,
    organizations: [{ id: ORG, name: 'Збережений ресторан' }, { id: OTHER, name: 'Інший ресторан' }] }) };
  const states = [], refs = [], effects = []; let stateIndex = 0, refIndex = 0, previous;
  const OrderPanel = () => React.createElement('div', { 'data-order-panel': true });
  const ReadinessPanel = () => React.createElement('div', { 'data-readiness-panel': true });
  const LoadingPanel = () => React.createElement('div', { 'data-loading-panel': true });
  const hooks = {
    useState(value) { const position = stateIndex++; if (!(position in states)) states[position] = value;
      return [states[position], value => { states[position] = typeof value === 'function' ? value(states[position]) : value; }]; },
    useRef(value) { const position = refIndex++; if (!(position in refs)) refs[position] = { current: value }; return refs[position]; },
    useEffect(effect, deps) { if (JSON.stringify(previous) !== JSON.stringify(deps)) { previous = deps; effects.push(effect); } },
  };
  const source = fs.readFileSync(path.resolve(__dirname, '../src/director/SyrveIntegrationDock.tsx'), 'utf8');
  const operationErrors = {}, operationErrorSource = fs.readFileSync(path.resolve(__dirname,
    '../src/director/services/syrveOperationErrors.ts'), 'utf8');
  vm.runInNewContext(ts.transpileModule(operationErrorSource, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    { exports: operationErrors });
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText,
    { exports, require: name => name === 'react' ? hooks : name === '../api/syrve' ? { syrveApi: api }
      : name === './SyrveOrderDiagnosticsPanel' ? { __esModule: true, default: OrderPanel }
      : name === './SyrveReadinessPanel' ? { __esModule: true, default: ReadinessPanel }
      : name === './SyrveTableLoadingPanel' ? { __esModule: true, default: LoadingPanel }
      : name === './SyrveAutoStatusPanel' ? { __esModule: true, default: () => null }
      : name === './services/syrveOperationErrors' ? operationErrors
      : name === './SyrveCatalogPreviewPanel' ? { __esModule: true, default: () => null } : require(name) });
  const render = () => { stateIndex = 0; refIndex = 0; const tree = exports.default(); while (effects.length) effects.shift()(); return tree; };
  const click = predicate => { const target = find(render(), predicate); assert.ok(target, 'actual dock control must exist'); target.props.onClick(); };
  return { render, click, saved, panels: tree => ({ order: find(tree, node => node.type === OrderPanel),
    readiness: find(tree, node => node.type === ReadinessPanel), loading: find(tree, node => node.type === LoadingPanel) }) };
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
    r => r.summary.linkedTables = 3, r => r.summary.unknownTables = -1, r => r.summary.tablesWithOccupancy = 1.5,
    r => r.summary.terminalGroups.alive = NaN, r => r.summary.unknownTables = 0,
    r => r.posVersions = null, r => r.posVersions.read.supported = NaN,
    r => r.posVersions.initialization.unknown = -1, r => r.posVersions.read.unknown = 1,
    r => Object.assign(r.posVersions.initialization, { supported: 2, unknown: 0 }),
    r => Object.assign(r.checks[4], { status: 'error', code: 'SYRVE_ACCESS_DENIED' })];
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
  for (const key of ['observedOrders', 'openOrders', 'explicitlyClosedOrders', 'unknownOrders', 'unresolvedKnownOrders']) input.summary[key] = 12345;
  input.posVersions.read.providerVersion = 'secret-credential';
  const checked = validateOrderDiagnostics(input, scope()); assert.ok(!JSON.stringify(checked).includes('secret-credential'));
  assert.ok(!JSON.stringify(checked).includes('12345'));
  const html = renderToStaticMarkup(React.createElement(SyrveOrderDiagnosticsView, { report: checked }));
  for (const text of ['Читання стану столів', 'Столи з ознаками зайнятості', 'Порожня відповідь', 'що стіл вільний', 'Синхронізація залишається вимкненою']) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /secret-credential|<button|configurationRevision|apiLogin|orderIds|[Зз]амовлен|12345/);
  assert.ok(!html.includes(VERSION)); assert.ok(!html.includes(ORG));
});

test('permission failure and sleeping or offline registers retain unknown tables and no positive closure', () => {
  const { validateOrderDiagnostics, SyrveOrderDiagnosticsView } = load();
  const value = report(); Object.assign(value.checks[4], { status: 'error', code: 'SYRVE_ACCESS_DENIED' });
  Object.assign(value.summary, { tablesWithOccupancy: 0, unknownTables: 2 });
  value.summary.terminalGroups = { alive: 0, sleeping: 1, offline: 1, unknown: 0 };
  const checked = validateOrderDiagnostics(value, scope());
  const html = renderToStaticMarkup(React.createElement(SyrveOrderDiagnosticsView, { report: checked }));
  assert.match(html, /Syrve не надав потрібного дозволу/); assert.match(html, /Сплячі касові групи: 1/);
  assert.match(html, /Недоступні: 1/); assert.equal(checked.summary.unknownTables, 2);
});

test('verified POS compatibility is table evidence and never makes synchronization or complete status available', () => {
  const { validateOrderDiagnostics, SyrveOrderDiagnosticsView } = load();
  const value = report();
  value.posVersions = { read: { supported: 2, unsupported: 0, unknown: 0 },
    initialization: { supported: 2, unsupported: 0, unknown: 0 } };
  value.diagnostics.posVersion = 'verified';
  const checked = validateOrderDiagnostics(value, scope());
  const html = renderToStaticMarkup(React.createElement(SyrveOrderDiagnosticsView, { report: checked }));
  assert.match(html, /Версія каси підтримує читання стану столів/);
  assert.match(html, /Повноту стану столів ще не підтверджено/);
  assert.match(html, /Синхронізація залишається вимкненою/);
  assert.equal(checked.diagnostics.complete, false); assert.equal(checked.activationAvailable, false);
  assert.doesNotMatch(html, /[Зз]амовлен|<button/);
});

test('unsupported and mixed POS versions give fixed actionable table diagnostics', () => {
  const { validateOrderDiagnostics, SyrveOrderDiagnosticsView } = load();
  for (const read of [{ supported: 0, unsupported: 2, unknown: 0 }, { supported: 1, unsupported: 1, unknown: 0 }]) {
    const value = report(); value.posVersions = { read, initialization: { ...read } }; value.diagnostics.posVersion = 'unsupported';
    const html = renderToStaticMarkup(React.createElement(SyrveOrderDiagnosticsView, { report: validateOrderDiagnostics(value, scope()) }));
    assert.match(html, /версії 7.4.6/); assert.match(html, /версії 7.7.1/); assert.match(html, /Оновіть несумісні каси/);
    assert.match(html, /Синхронізація залишається вимкненою/);
  }
  const value = report(); value.posVersions = { read: { supported: 2, unsupported: 0, unknown: 0 },
    initialization: { supported: 0, unsupported: 2, unknown: 0 } }; value.diagnostics.posVersion = 'verified';
  const html = renderToStaticMarkup(React.createElement(SyrveOrderDiagnosticsView, { report: validateOrderDiagnostics(value, scope()) }));
  assert.match(html, /Версія каси підтримує читання/); assert.match(html, /версії 7.7.1/);
});

test('missing, inconsistent or failed-scope version evidence cannot be reused as verified support', () => {
  const { validateOrderDiagnostics } = load();
  const mutations = [r => delete r.posVersions, r => r.diagnostics.posVersion = 'unexpected',
    r => r.posVersions.read.unknown = 3, r => r.posVersions.initialization.unknown = 1,
    r => { r.posVersions = { read: { supported: 2, unsupported: 0, unknown: 0 },
      initialization: { supported: 2, unsupported: 0, unknown: 0 } }; r.diagnostics.posVersion = 'verified';
      r.checks[2].status = 'not_checked'; r.summary.tablesWithOccupancy = 0; r.summary.unknownTables = 2; },
    r => { r.posVersions = { read: { supported: 0, unsupported: 2, unknown: 0 },
      initialization: { supported: 2, unsupported: 0, unknown: 0 } }; r.diagnostics.posVersion = 'unsupported'; }];
  for (const mutate of mutations) { const value = report(); mutate(value); assert.throws(() => validateOrderDiagnostics(value, scope()), /Недійсний/); }
});

test('actual dock opens saved diagnostics separately from credential and organization drafts', async () => {
  const h = dock(); h.render(); await flush(); h.click(node => node.type === 'button' && node.props['aria-label']?.startsWith('Syrve підключено'));
  await flush();
  let tree = h.render(); assert.ok(h.panels(tree).order); assert.ok(h.panels(tree).readiness);
  assert.equal(find(tree, node => node.type === 'input' && node.props.type === 'password'), null);
  h.click(node => node.type === 'button' && text(node) === 'Змінити дані');
  tree = h.render(); assert.equal(h.panels(tree).order, null); assert.equal(h.panels(tree).readiness, null);
  assert.equal(find(tree, node => node.type === 'button' && text(node) === 'Відключити'), null);
  const input = find(tree, node => node.type === 'input' && node.props.type === 'password');
  assert.ok(input); input.props.onChange({ target: { value: 'test-only-api-secret' } });
  h.click(node => node.type === 'button' && text(node).includes('Перевірити підключення')); await flush();
  h.click(node => node.type === 'button' && text(node).includes('Інший ресторан'));
  tree = h.render(); assert.equal(h.panels(tree).order, null); assert.equal(h.panels(tree).readiness, null);
  assert.equal(h.saved.configurationRevision, VERSION); assert.equal(h.saved.organizationId, ORG);
});

test('editing the actual dock unmounts a pending saved probe despite an unchanged saved revision', async () => {
  const h = dock(); h.render(); await flush(); h.click(node => node.type === 'button' && node.props['aria-label']?.startsWith('Syrve підключено'));
  await flush();
  assert.ok(h.panels(h.render()).order);
  const response = deferred(), child = mounted({ orderDiagnostics: () => response.promise }); child.click();
  h.click(node => node.type === 'button' && text(node) === 'Змінити дані');
  assert.equal(h.panels(h.render()).order, null); child.unmount();
  response.resolve(report()); await flush(); assert.equal(child.states[0], null);
});

test('cancel and reopen return to the saved summary instead of exposing the cancelled draft', async () => {
  const h = dock(); h.render(); await flush();
  const cloud = node => node.type === 'button' && node.props['aria-label']?.startsWith('Syrve підключено');
  h.click(cloud); await flush(); h.click(node => node.type === 'button' && text(node) === 'Змінити дані');
  const draftName = find(h.render(), node => node.type === 'input' && node.props.value === h.saved.displayName);
  assert.ok(draftName); draftName.props.onChange({ target: { value: 'Незбережена чернетка' } });
  assert.equal(h.panels(h.render()).order, null);
  h.click(node => node.type === 'button' && node.props['aria-label'] === 'Закрити налаштування Syrve');
  h.click(cloud); await flush(); const tree = h.render(); assert.ok(h.panels(tree).order); assert.ok(h.panels(tree).readiness);
  assert.equal(find(tree, node => node.type === 'input' && node.props.type === 'password'), null);
  assert.equal(h.saved.configurationRevision, VERSION);
  h.click(node => node.type === 'button' && text(node) === 'Змінити дані');
  assert.ok(find(h.render(), node => node.type === 'input' && node.props.value === h.saved.displayName));
});

test('actual dock blocks sibling operations during table loading and refreshes the consumed revision', async () => {
  const h=dock();h.render();await flush();
  h.click(node=>node.type==='button'&&node.props['aria-label']?.startsWith('Syrve підключено'));await flush();
  const panel=h.panels(h.render()).loading;assert.ok(panel);panel.props.onBusyChange(true);
  let tree=h.render();assert.equal(h.panels(tree).order.props.busy,true);assert.equal(h.panels(tree).loading.props.busy,false);
  for(const label of ['Перевірити','Змінити дані','Відключити'])assert.equal(find(tree,node=>node.type==='button'&&text(node)===label).props.disabled,true);
  h.saved.configurationRevision=OTHER;
  await panel.props.onFinished({readCompleted:true});tree=h.render();
  assert.equal(h.panels(tree).loading.props.configurationRevision,OTHER);assert.equal(h.panels(tree).order.props.busy,false);
  assert.ok(text(tree).includes('Syrve підтвердив завантаження стану столів. Синхронізація ще вимкнена.'));
});

test('actual dock reloads saved revision when an accepted loading operation outlives its closed panel', async () => {
  const h=dock();h.render();await flush();const cloud=node=>node.type==='button'&&node.props['aria-label']?.startsWith('Syrve підключено');
  h.click(cloud);await flush();h.panels(h.render()).loading.props.onBusyChange(true);
  h.click(node=>node.type==='button'&&node.props['aria-label']==='Закрити налаштування Syrve');
  h.saved.configurationRevision=OTHER;h.click(cloud);await flush();
  assert.equal(h.panels(h.render()).loading.props.configurationRevision,OTHER);
  assert.equal(h.panels(h.render()).order.props.busy,false);
});
