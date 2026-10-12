const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const REV = 'a0000000-0000-4000-8000-000000000001';
const ORG = 'b0000000-0000-4000-8000-000000000001';
const OTHER = 'c0000000-0000-4000-8000-000000000001';
const scope = { configurationRevision: REV, organizationId: ORG };
const report = () => ({ ...scope, startedAt: '2026-10-12T09:00:00Z', checkedAt: '2026-10-12T09:00:01Z',
  settingsReadAccess: 'confirmed', settingsWriteAccess: 'not_checked', webhookAddressSet: true,
  authorizationSet: true, settingsChanged: false, statusesApplied: false });
const setupReport = () => ({ ...scope, startedAt: '2026-10-12T09:00:00Z', checkedAt: '2026-10-12T09:00:01Z',
  settingsReadAccess: 'confirmed', settingsWriteAccess: 'confirmed', notificationsConfigured: true,
  settingsChanged: true, statusesApplied: false, deliveryVerified: false });
function load(api = {}, react = React) {
  const errors = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.resolve(__dirname,
    '../src/director/services/syrveOperationErrors.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    { exports: errors });
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.resolve(__dirname,
    '../src/director/SyrveWebhookDiagnosticsPanel.tsx'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText,
  { exports, require: name => name === 'react' ? react : name === '../api/syrve' ? { syrveApi: api }
    : name === './services/syrveOperationErrors' ? errors : require(name) });
  return exports;
}
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function find(node, predicate) {
  if (!node || typeof node !== 'object') return null;
  if (predicate(node)) return node;
  for (const child of [node.props?.children].flat(Infinity)) { const match = find(child, predicate); if (match) return match; }
  return null;
}
function mounted(api) {
  const states = [], refs = [], effects = []; let stateIndex = 0, refIndex = 0, previous, cleanup;
  let props = { ...scope, connectionReady: true, busy: false };
  const component = load(api, {
    useState(value) { const i = stateIndex++; if (!(i in states)) states[i] = value;
      return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value; }]; },
    useRef(value) { const i = refIndex++; if (!(i in refs)) refs[i] = { current: value }; return refs[i]; },
    useEffect(effect, deps) { if (JSON.stringify(previous) !== JSON.stringify(deps)) { previous = deps; effects.push(effect); } },
  }).default;
  const render = changes => {
    props = { ...props, ...changes }; stateIndex = 0; refIndex = 0;
    const tree = component(props); while (effects.length) { cleanup?.(); cleanup = effects.shift()(); } return tree;
  };
  return { states, render, click: () => find(render(), node => node.type === 'button').props.onClick(),
    setupClick: () => find(render(), node => node.type === 'button' && node.props.children === 'Підключити сповіщення для MOLO').props.onClick(),
    unmount: () => cleanup?.() };
}

test('the API adapter sends only the saved revision through the asynchronous operation flow', async () => {
  const exports = {}; let request;
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '../src/api/syrve.ts'), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
  { exports, require: require('./helpers/syrve-operation-fixture.cjs').resolver({
    post: async (url, payload) => { request = { url, payload }; return report(); },
  }) });
  await exports.syrveApi.webhookDiagnostics(REV);
  assert.deepEqual(JSON.parse(JSON.stringify(request)), { url: '/syrve-integration/webhook-diagnostics', payload: { configurationRevision: REV } });
});

test('mount and saved-setting refresh send no provider request; duplicate clicks share one operation', async () => {
  let calls = 0; const response = deferred();
  const h = mounted({ webhookDiagnostics: revision => { assert.equal(revision, REV); calls++; return response.promise; } });
  h.render(); await flush(); assert.equal(calls, 0);
  h.click(); h.click(); assert.equal(calls, 1);
  response.resolve(report()); await flush();
  assert.equal(h.states[0].settingsReadAccess, 'confirmed'); assert.equal(h.states[1], false);
});

test('disconnect, revision changes, a new busy operation and unmount discard delayed reports', async () => {
  for (const change of [{ configurationRevision: OTHER }, { organizationId: OTHER }, { connectionReady: false }, { busy: true }, null]) {
    const response = deferred(), h = mounted({ webhookDiagnostics: () => response.promise });
    h.click(); if (change) h.render(change); else h.unmount();
    const before = JSON.stringify(h.states); response.resolve(report()); await flush();
    assert.equal(JSON.stringify(h.states), before);
  }
});

test('unknown and denied provider errors show fixed messages without exposing appended secrets', async () => {
  for (const [cause, expected] of [[{ code: 'SYRVE_ACCESS_DENIED', message: 'private-provider-token' }, 'Syrve не надав права'],
    [new Error('private-provider-token'), 'Перевірку сповіщень не завершено'],
    [{ code: 'SYRVE_INVALID_RESPONSE' }, 'Syrve повернув неповну або неочікувану відповідь']]) {
    const h = mounted({ webhookDiagnostics: async () => { throw cause; } });
    h.click(); await flush(); assert.match(h.states[2], new RegExp(expected));
    assert.doesNotMatch(h.states[2], /private-|Синхронізацію не ввімкнено/);
  }
});

test('public reports strip raw fields and never turn a successful read into write permission or delivery proof', () => {
  const { validateWebhookDiagnostics, SyrveWebhookDiagnosticsView } = load();
  const clean = validateWebhookDiagnostics({ ...report(), authToken: 'private-token', webHooksUri: 'private-url' }, scope);
  assert.doesNotMatch(JSON.stringify(clean), /private-|authToken|webHooksUri/);
  const html = renderToStaticMarkup(React.createElement(SyrveWebhookDiagnosticsView, { report: clean }));
  assert.match(html, /Право змінювати налаштування окремо не перевірено/);
  assert.match(html, /ще не підтверджує доставку/);
  for (const change of [{ configurationRevision: OTHER }, { organizationId: OTHER }, { settingsWriteAccess: 'confirmed' },
    { settingsChanged: true }, { statusesApplied: true }, { webhookAddressSet: 'yes' }, { checkedAt: 'bad' }]) {
    assert.throws(() => validateWebhookDiagnostics({ ...report(), ...change }, scope));
  }
});

test('optional verification is strictly validated, strips extra fields and explains the saved filter mismatch', () => {
  const { validateWebhookDiagnostics, SyrveWebhookDiagnosticsView } = load();
  const verification = { addressMatches: true, authorizationMatches: true, tableFilterPresent: true,
    orderStatusesMatch: true, itemStatusesMatch: true };
  const clean = validateWebhookDiagnostics({ ...report(), verification: { ...verification, authToken: 'private-token' } }, scope);
  assert.doesNotMatch(JSON.stringify(clean), /private-|authToken/);
  const render = value => renderToStaticMarkup(React.createElement(SyrveWebhookDiagnosticsView, {
    report: validateWebhookDiagnostics({ ...report(), verification: value }, scope) }));
  assert.match(render(verification), /Фільтр потрібних змін рахунку підтверджено/);
  assert.match(render({ ...verification, addressMatches: false }), /Адреса не відповідає/);
  assert.match(render({ ...verification, authorizationMatches: false }), /Захист сповіщень не відповідає/);
  assert.match(render({ ...verification, tableFilterPresent: false }), /не повернув фільтр/);
  assert.match(render({ ...verification, orderStatusesMatch: false }), /не підтвердив сповіщення про відкриття/);
  assert.match(render({ ...verification, itemStatusesMatch: false }), /обмеження за позиціями/);
  for (const bad of [null, [], 'private-value', {}, { ...verification, authorizationMatches: 'yes' },
    { ...verification, itemStatusesMatch: undefined }]) assert.throws(() => validateWebhookDiagnostics({ ...report(), verification: bad }, scope));
  assert.equal(validateWebhookDiagnostics(report(), scope).verification, undefined, 'older backend responses remain usable during deployment');
});

test('setup mismatch codes display fixed reasons and discard private provider messages', async () => {
  for (const [code, expected] of [
    ['SYRVE_WEBHOOK_ADDRESS_NOT_CONFIRMED', 'не підтвердив адресу'],
    ['SYRVE_WEBHOOK_AUTHORIZATION_NOT_CONFIRMED', 'не підтвердив захист'],
    ['SYRVE_WEBHOOK_TABLE_FILTER_NOT_CONFIRMED', 'не повернув фільтр'],
    ['SYRVE_WEBHOOK_ORDER_STATUSES_NOT_CONFIRMED', 'всі потрібні стани'],
    ['SYRVE_WEBHOOK_ITEM_FILTER_NOT_CONFIRMED', 'обмеження за позиціями'],
  ]) {
    const h = mounted({ configureWebhook: async () => { throw { code, message: 'private-provider-token' }; } });
    h.render({ syncEnabled: true }); h.setupClick(); await flush();
    assert.match(h.states[2], new RegExp(expected)); assert.doesNotMatch(h.states[2], /private-/);
    assert.equal(h.states[3], null);
  }
});

test('setup adapter sends only current revision and explicit confirmation; URL and secrets stay off the browser request', async () => {
  const exports = {}; let request;
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '../src/api/syrve.ts'), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
  { exports, require: require('./helpers/syrve-operation-fixture.cjs').resolver({
    post: async (url, payload) => { request = { url, payload }; return setupReport(); },
  }) });
  await exports.syrveApi.configureWebhook(REV);
  assert.deepEqual(JSON.parse(JSON.stringify(request)), { url: '/syrve-integration/webhook-setup', payload: { configurationRevision: REV, confirmed: true } });
});

test('setup requires enabled auto-status and an explicit click; repeated clicks share one operation', async () => {
  let calls = 0; const response = deferred();
  const h = mounted({ configureWebhook: revision => { assert.equal(revision, REV); calls++; return response.promise; } });
  h.render(); await flush(); assert.equal(calls, 0);
  h.setupClick(); assert.equal(calls, 0);
  h.render({ syncEnabled: true }); await flush(); assert.equal(calls, 0);
  h.setupClick(); h.setupClick(); assert.equal(calls, 1);
  response.resolve(setupReport()); await flush(); assert.equal(h.states[3].notificationsConfigured, true);
  assert.equal(h.states[1], false);
});

test('disabled consent, disconnect, revision rotation and closed screen discard delayed setup results', async () => {
  for (const change of [{ syncEnabled: false }, { connectionReady: false }, { configurationRevision: OTHER }, { organizationId: OTHER }, null]) {
    const response = deferred(), h = mounted({ configureWebhook: () => response.promise });
    h.render({ syncEnabled: true }); h.setupClick();
    if (change) h.render(change); else h.unmount();
    const before = JSON.stringify(h.states); response.resolve(setupReport()); await flush();
    assert.equal(JSON.stringify(h.states), before);
  }
});

test('setup exposes fixed permission errors without displaying raw provider text or tokens', async () => {
  const h = mounted({ configureWebhook: async () => { throw { code: 'SYRVE_WEBHOOK_WRITE_DENIED', message: 'private-provider-token' }; } });
  h.render({ syncEnabled: true }); h.setupClick(); await flush();
  assert.match(h.states[2], /не має права змінювати/); assert.doesNotMatch(h.states[2], /private-/);
  assert.equal(h.states[3], null);
});

test('a setup result strips URL/token/filter fields and never presents settings as proven delivery', () => {
  const { validateWebhookSetup, SyrveWebhookSetupView } = load();
  const clean = validateWebhookSetup({ ...setupReport(), authToken: 'private-token', webHooksUri: 'private-url', webHooksFilter: { privateKey: 'private-value' } }, scope);
  assert.doesNotMatch(JSON.stringify(clean), /private-|authToken|webHooksUri|webHooksFilter/);
  const html = renderToStaticMarkup(React.createElement(SyrveWebhookSetupView, { report: clean }));
  assert.match(html, /налаштовано та перевірено в Syrve/); assert.match(html, /Доставку ще потрібно перевірити/);
  for (const change of [{ organizationId: OTHER }, { configurationRevision: OTHER }, { notificationsConfigured: false },
    { deliveryVerified: true }, { statusesApplied: true }, { checkedAt: ['2026-10-12T09:00:01Z'] },
    { settingsWriteAccess: 'not_checked', settingsChanged: true }]) assert.throws(() => validateWebhookSetup({ ...setupReport(), ...change }, scope));
});
