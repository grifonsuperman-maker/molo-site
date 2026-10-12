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
  return { states, render, click: () => find(render(), node => node.type === 'button').props.onClick(), unmount: () => cleanup?.() };
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
