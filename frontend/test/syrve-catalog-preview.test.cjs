const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const ORG = 'a0000000-0000-4000-8000-000000000001';
const OTHER = 'a0000000-0000-4000-8000-000000000002';
const source = fs.readFileSync(path.resolve(__dirname, '../src/director/SyrveIntegrationDock.tsx'), 'utf8');
const parsed = ts.createSourceFile('dock.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function handler(name, dependencies) {
  let declaration;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) declaration = node.getText(parsed);
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  assert.ok(declaration, `actual production handler ${name} must exist`);
  const js = ts.transpileModule(declaration, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  return new Function(...Object.keys(dependencies), `${js}\nreturn ${name};`)(...Object.values(dependencies));
}
function harness(api = {}) {
  const state = { preview: null, busy: false, error: null, notice: null, login: 'test-api-secret', organization: ORG, step: 2, open: true, acknowledged: false, status: null };
  const deps = { displayName: 'MOLO', apiBaseUrl: 'https://api-eu.syrve.live', apiLogin: state.login,
    organizationId: ORG, organizations: [{ id: ORG, name: 'MOLO' }], catalogPreview: null,
    mappingAcknowledged: false, setMappingAcknowledged: (value) => state.acknowledged = value, status: { configurationRevision: ORG },
    requestVersion: { current: 0 }, statusRequestVersion: { current: 0 }, syrveApi: api,
    settledStatusLoadState: { current: 'ready' },
    statusLoadState: 'ready', busy: false, loadingTables: false, changingAutoStatus: false,
    setStatusLoaded: (value) => state.statusLoaded = value,
    setStatusLoadState: (value) => { state.statusLoadState = value; deps.statusLoadState = value; },
    setCatalogPreview: (value) => state.preview = value, setBusy: (value) => state.busy = value,
    setLoadingTables: (value) => state.loadingTables = value,
    setChangingAutoStatus: (value) => state.changingAutoStatus = value,
    setError: (value) => state.error = value, setNotice: (value) => state.notice = value,
    setApiLogin: (value) => state.login = value, setOrganizationId: (value) => state.organization = value,
    setOpen: (value) => state.open = value, setStep: (value) => state.step = value,
    setEditingConnection: (value) => state.editingConnection = value,
    setOrganizations: (value) => state.organizations = value,
    setShowLogin() {}, setStatus: (value) => state.status = value, setDisplayName() {}, setApiBaseUrl() {} };
  deps.applyStatus = handler('applyStatus', deps);
  return { state, deps, run: (name) => handler(name, deps) };
}
const result = (organizationId = ORG) => ({ organization: { id: organizationId, name: 'MOLO' }, syncEnabled: false,
  proposals: [], confirmation: null, confirmedLinks: [], mappingConfirmationAvailable: false });
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('preview sends only the selected organization to the MOLO backend and retains sync off', async () => {
  let input;
  const h = harness({ previewTables: async (payload) => { input = payload; return result(); } });
  await h.run('previewTables')();
  assert.equal(input.organizationId, ORG);
  assert.equal(h.state.preview.syncEnabled, false);
  assert.equal(h.state.preview.mappingConfirmationAvailable, false);
  assert.equal(h.state.busy, false);
});

test('changing the restaurant clears suggestions and discards an in-flight response', async () => {
  const request = deferred();
  const h = harness({ previewTables: () => request.promise });
  const pending = h.run('previewTables')();
  h.run('chooseOrganization')(OTHER);
  request.resolve(result());
  await pending;
  assert.equal(h.state.organization, OTHER);
  assert.equal(h.state.preview, null);
  assert.equal(h.state.busy, false);
});

test('closing the dock clears typed credentials and prevents a late preview from reappearing', async () => {
  const request = deferred();
  const h = harness({ previewTables: () => request.promise });
  const pending = h.run('previewTables')();
  h.run('close')();
  request.resolve(result());
  await pending;
  assert.equal(h.state.login, '');
  assert.equal(h.state.open, false);
  assert.equal(h.state.preview, null);
  assert.equal(h.state.step, 1);
});

test('a failed refresh removes old suggestions and reports an actionable API error', async () => {
  const h = harness({ previewTables: async () => { throw new Error('Syrve не надав права для цієї перевірки.'); } });
  h.state.preview = result();
  await h.run('previewTables')();
  assert.equal(h.state.preview, null);
  assert.match(h.state.error, /не надав права/);
});

test('a foreign organization response is rejected before showing proposals', async () => {
  const h = harness({ previewTables: async () => result(OTHER) });
  await h.run('previewTables')();
  assert.equal(h.state.preview, null);
  assert.match(h.state.error, /іншого ресторану/);
});

test('saving credentials is blocked without a preview for the selected restaurant', async () => {
  const h = harness({ connect: () => assert.fail('must not save before catalog check') });
  await h.run('connect')();
  assert.match(h.state.error, /Спочатку перевірте столи/);
  h.deps.catalogPreview = result(OTHER);
  await h.run('connect')();
  assert.match(h.state.error, /Спочатку перевірте столи/);
});

test('actual frontend API adapter sends preview to MOLO, never to Syrve directly', async () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../src/api/syrve.ts'), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  let request;
  const exports = {};
  vm.runInNewContext(js, { exports, require: (name) => {
    assert.equal(name, './client');
    return { api: { post: async (url, payload) => { request = { url, payload }; return result(); } } };
  } });
  await exports.syrveApi.previewTables({ organizationId: ORG, apiLogin: 'test-api-secret' });
  assert.equal(request.url, '/syrve-integration/tables-preview');
  assert.equal(request.payload.organizationId, ORG);
});

test('Director panel renders counts, unmatched tables/conflicts and escapes upstream text', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../src/director/SyrveCatalogPreviewPanel.tsx'), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  vm.runInNewContext(js, { exports, require });
  const preview = { ...result(), organization: { id: ORG, name: '<script>alert(1)</script>' },
    summary: { syrveTables: 61, proposals: 59, missingInMolo: 2, missingInSyrve: 1, conflicts: 1, deletedTables: 1 },
    proposals: [{ moloTableId: 'molo-12', moloTableNumber: '12', syrveTableId: 'syrve-12', syrveTableNumber: 12, sectionName: 'Зал' }],
    missingInMolo: [{ id: 'syrve-77', number: 77, name: 'Тераса', sectionName: 'Літо' }],
    missingInSyrve: [{ id: 'molo-13', tableNumber: '13' }],
    deletedTables: [{ id: 'syrve-99', number: 99, name: 'Видалений' }],
    conflicts: [{ code: 'duplicate_syrve_number', number: '14', moloTableIds: ['molo-14'], syrveTableIds: ['syrve-a', 'syrve-b'] }],
    diagnostics: { warnings: ['Доступ до замовлень ще не перевірено.'],
      receivedSections: [{ sectionName: 'Основний зал', terminalGroupName: 'Каса 1', tableNumbers: [1, 2, 3, 7] }] } };
  const html = renderToStaticMarkup(React.createElement(exports.default, { preview }));
  for (const text of ['61', '59', 'Syrve №77', 'MOLO №13', 'однаковий номер', 'ще не збережені', 'не перевірено',
    'Отримані секції Syrve', 'Основний зал', 'Каса 1', '1-3, 7']) assert.ok(html.includes(text), text);
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('Увімкнути синхронізацію'));
});

test('confirmation needs both a server receipt and an explicit Director acknowledgement', async () => {
  const h = harness({ connect: () => assert.fail('must not save without review') });
  h.deps.catalogPreview = { ...result(), proposals: [{ moloTableId: ORG, syrveTableId: OTHER }] };
  await h.run('connect')();
  assert.match(h.state.error, /поки недоступне/);
  h.deps.catalogPreview.confirmation = { proof: 'synthetic-preview-receipt' };
  await h.run('connect')();
  assert.match(h.state.error, /Підтвердьте запропоновані/);
});

test('confirmed save sends only selected UUID pairs and the receipt to MOLO', async () => {
  let payload;
  const h = harness({ connect: async (value) => { payload = value; return { integration: { confirmedLinks: 1, syncEnabled: false } }; } });
  h.deps.mappingAcknowledged = true;
  h.deps.catalogPreview = { ...result(), confirmation: { proof: 'synthetic-preview-receipt' },
    proposals: [{ moloTableId: ORG, syrveTableId: OTHER, moloTableNumber: '12', syrveTableNumber: 12 }] };
  await h.run('connect')();
  assert.deepEqual(payload.pairs, [{ moloTableId: ORG, syrveTableId: OTHER }]);
  assert.equal(payload.confirmationProof, 'synthetic-preview-receipt');
  assert.equal(h.state.login, '');
  assert.equal(h.state.status.confirmedLinks, 1);
  assert.equal(h.state.status.syncEnabled, false);
  assert.equal(h.state.editingConnection, false);
  assert.equal(h.state.step, 3);
});

test('a rejected confirmation invalidates the preview and requires a fresh acknowledgement', async () => {
  const h = harness({ connect: async () => { throw new Error('Налаштування або столи змінилися'); } });
  h.deps.mappingAcknowledged = true;
  h.deps.catalogPreview = { ...result(), confirmation: { proof: 'synthetic-preview-receipt' } };
  h.state.preview = h.deps.catalogPreview;
  h.state.acknowledged = true;
  await h.run('connect')();
  assert.equal(h.state.preview, null);
  assert.equal(h.state.acknowledged, false);
  assert.match(h.state.error, /змінилися/);
});

test('closing during confirmation discards the late saved-status response', async () => {
  const request = deferred();
  const h = harness({ connect: () => request.promise });
  h.deps.catalogPreview = { ...result(), confirmation: { proof: 'synthetic-preview-receipt' } };
  const pending = h.run('connect')();
  h.run('close')();
  request.resolve({ integration: { confirmedLinks: 1 } });
  await pending;
  assert.equal(h.state.status, null);
  assert.equal(h.state.open, false);
  assert.equal(h.state.step, 1);
});

test('a late initial status load cannot overwrite a new connection dialog', async () => {
  const request = deferred();
  const h = harness({ getStatus: () => request.promise });
  const pending = h.run('load')();
  h.run('chooseOrganization')(OTHER);
  request.resolve({ displayName: 'Old settings', organizationId: ORG });
  await pending;
  assert.equal(h.state.status, null);
});

test('frontend recheck sends the saved configuration revision and discards stale replies', async () => {
  const request = deferred();
  let version;
  const h = harness({ recheck: (value) => { version = value; return request.promise; } });
  const pending = h.run('recheck')();
  h.run('close')();
  request.resolve({ integration: { configurationRevision: OTHER } });
  await pending;
  assert.equal(version, ORG);
  assert.equal(h.state.status, null);
});
