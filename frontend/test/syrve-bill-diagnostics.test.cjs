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
  const errors = {};
  const errorSource = fs.readFileSync(path.resolve(__dirname, '../src/director/services/syrveOperationErrors.ts'), 'utf8');
  vm.runInNewContext(ts.transpileModule(errorSource, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: errors });
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText,
    { exports, require: name => name === '../api/syrve' ? { syrveApi: deps.api || {} }
      : name === './services/syrveOperationErrors' ? errors
      : name === 'react' ? deps.react || React : require(name) });
  return exports;
}
function find(node, type) {
  if (!node || typeof node !== 'object') return null;
  if (node.type === type) return node;
  for (const child of [node.props?.children].flat(Infinity)) { const found = find(child, type); if (found) return found; }
  return null;
}
function all(node, type) {
  if (!node || typeof node !== 'object') return [];
  return [...(node.type === type ? [node] : []), ...[node.props?.children].flat(Infinity).flatMap(child => all(child, type))];
}
const button = (tree, label) => all(tree, 'button').find(node => node.props.children === label);
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
  const flushEffects = () => { while (effects.length) { cleanup?.(); cleanup = effects.shift()(); } };
  const render = (changes, runEffects = true) => {
    props = { ...props, ...changes }; stateIndex = 0; refIndex = 0; const tree = component(props);
    if (runEffects) flushEffects();
    return tree;
  };
  return { states, render, renderBeforeEffects: changes => render(changes, false), flushEffects,
    input: value => { find(render(), 'input').props.onChange({ target: { value } }); render(); },
    click: () => find(render(), 'button').props.onClick(), unmount: () => cleanup?.(),
    prepare: () => button(render(), 'Обрати касу для перевірки').props.onClick(),
    consent: value => all(render(), 'input').find(node => node.props.type === 'checkbox').props.onChange({ target: { checked: value } }),
    choose: value => { find(render(), 'select').props.onChange({ target: { value } }); render(); },
    loadPos: () => button(render(), 'Завантажити з каси та перевірити').props.onClick() };
}

function registers() {
  return { configurationRevision: VERSION, organizationId: ORG, checkedAt: '2026-10-08T07:00:01Z',
    registers: [{ id: OTHER, name: 'Тестова каса', posVersion: '7.7.1', loadingSupported: true }] };
}
function loadedReport() {
  const value = report(); value.order.sum = 80;
  value.posLoading = { terminalGroupId: OTHER, terminalGroupName: 'Тестова каса', correlationId: VERSION, requestAccepted: true };
  return value;
}

test('API adapter sends only the saved revision and bill UUID through existing async operation polling', async () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/api/syrve.ts'), 'utf8');
  const exports = {}; let request;
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    { exports, require: require('./helpers/syrve-operation-fixture.cjs').resolver({ post: async (url, payload) => { request = { url, payload }; return report(); } }) });
  await exports.syrveApi.billDiagnostics(VERSION, POS);
  assert.deepEqual(JSON.parse(JSON.stringify(request)), { url: '/syrve-integration/bill-diagnostics', payload: { configurationRevision: VERSION, orderId: POS } });
  await exports.syrveApi.billRegisters(VERSION);
  assert.deepEqual(JSON.parse(JSON.stringify(request)), { url: '/syrve-integration/bill-registers', payload: { configurationRevision: VERSION } });
  await exports.syrveApi.posBillDiagnostics(VERSION, POS, OTHER);
  assert.deepEqual(JSON.parse(JSON.stringify(request)), { url: '/syrve-integration/bill-loading-diagnostics',
    payload: { configurationRevision: VERSION, orderId: POS, terminalGroupId: OTHER, confirmed: true } });
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

test('register versions can be checked without a bill UUID while bill reading and POS loading remain guarded', async () => {
  const calls = [];
  const h = mounted({ billRegisters: async version => { calls.push(['registers', version]); return registers(); },
    billDiagnostics: () => assert.fail('no bill was requested'), posBillDiagnostics: () => assert.fail('no loading was confirmed') });
  let tree = h.render();
  assert.equal(button(tree, 'Обрати касу для перевірки').props.disabled, false);
  assert.equal(button(tree, 'Перевірити рахунок').props.disabled, true);
  h.prepare(); h.prepare(); await flush(); tree = h.render();
  assert.deepEqual(calls, [['registers', VERSION]]);
  assert.equal(button(tree, 'Завантажити з каси та перевірити').props.disabled, true);
  assert.equal(all(tree, 'input').find(node => node.props.type === 'checkbox').props.disabled, true);
  h.click(); h.consent(true); h.loadPos(); await flush(); assert.deepEqual(calls, [['registers', VERSION]]);
});

test('register preparation still needs a current saved connection and discards a delayed response when the panel closes', async () => {
  for (const changes of [{ connectionReady: false }, { busy: true }, { configurationRevision: null }, { organizationId: null }]) {
    const h = mounted({ billRegisters: () => assert.fail('unavailable scope must not request registers') });
    const tree = h.render(changes); assert.equal(button(tree, 'Обрати касу для перевірки').props.disabled, true);
    h.prepare(); await flush();
  }
  const response = deferred(); const h = mounted({ billRegisters: () => response.promise });
  h.prepare(); h.unmount(); const before = JSON.stringify(h.states);
  response.resolve(registers()); await flush(); assert.equal(JSON.stringify(h.states), before);
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

test('diagnostics display fixed access, register and response errors without suggesting sync was disabled', async () => {
  for (const [message, expected] of [
    ['Syrve не надав права для цієї перевірки.', /не надав права/],
    ['Обрана касова група зараз не відповідає. Завантаження рахунку не виконано.', /касова група зараз не відповідає/],
    ['Обрана касова група недоступна або її версія не підтримує завантаження рахунків.', /версія не підтримує/],
    ['Syrve повернув неочікувану відповідь. Синхронізацію не ввімкнено.', /неповну або неочікувану відповідь/],
  ]) {
    const h = mounted({ billDiagnostics: async () => { throw new Error(message); } });
    h.input(POS); h.click(); await flush(); const html = renderToStaticMarkup(h.render());
    assert.match(html, expected); assert.doesNotMatch(html, /Синхронізацію не ввімкнено/);
  }
});

test('diagnostic errors reject private suffixes and late errors after scope changes', async () => {
  const h = mounted({ billDiagnostics: async () => { throw new Error('Обрана касова група зараз не відповідає. Завантаження рахунку не виконано. private-secret'); } });
  h.input(POS); h.click(); await flush(); assert.doesNotMatch(renderToStaticMarkup(h.render()), /private-secret/);
  let reject; const promise = new Promise((_, no) => { reject = no; });
  const stale = mounted({ billDiagnostics: () => promise });
  stale.input(POS); stale.click(); stale.render({ configurationRevision: OTHER });
  reject(new Error('Syrve не надав права для цієї перевірки.')); await flush();
  assert.equal(stale.states[3], false); assert.equal(stale.states[8], '');
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

test('registers require explicit preparation and POS loading requires fresh selection plus separate consent', async () => {
  const calls = [], response = deferred();
  const h = mounted({ billRegisters: async version => { calls.push(['registers', version]); return registers(); },
    posBillDiagnostics: (version, id, group) => { calls.push(['load', version, id, group]); return response.promise; } });
  h.render(); h.input(POS); await flush(); assert.deepEqual(calls, []);
  h.prepare(); h.prepare(); await flush(); h.render();
  assert.deepEqual(calls, [['registers', VERSION]]); assert.equal(find(h.render(), 'select').props.value, OTHER);
  h.loadPos(); await flush(); assert.equal(calls.length, 1, 'selection alone must not initialize a POS order');
  h.consent(true); h.loadPos(); h.loadPos();
  assert.deepEqual(calls[1], ['load', VERSION, POS, OTHER]); assert.equal(calls.length, 2);
  response.resolve(loadedReport()); await flush();
  assert.equal(h.states[1].posLoading.requestAccepted, true); assert.equal(h.states[1].order.sum, 80); assert.equal(h.states[2], false);
  assert.equal(h.states[6], null, 'an accepted attempt consumes consent');
});

test('unsupported or unknown registers cannot load a bill and several supported registers require selection', async () => {
  for (const items of [[{ id: OTHER, name: 'Невідома', posVersion: null, loadingSupported: false }],
    [{ id: OTHER, name: 'Перша', posVersion: '7.7.1', loadingSupported: true },
      { id: TABLE, name: 'Друга', posVersion: '9.0.0', loadingSupported: true }]]) {
    let loads = 0;
    const h = mounted({ billRegisters: async () => ({ ...registers(), registers: items }), posBillDiagnostics: () => { loads++; } });
    h.input(POS); h.prepare(); await flush(); h.render();
    assert.equal(find(h.render(), 'select').props.value, ''); h.consent(true); h.loadPos(); assert.equal(loads, 0);
  }
});

test('late register preparation and POS reports cannot survive scope, candidate, register or sibling changes', async () => {
  for (const change of [{ configurationRevision: OTHER }, { organizationId: OTHER }, { busy: true }, { connectionReady: false }]) {
    const response = deferred(); const h = mounted({ billRegisters: () => response.promise });
    h.input(POS); h.prepare(); h.render(change); response.resolve(registers()); await flush(); assert.equal(h.states[4], null);
  }
  for (const change of [{ configurationRevision: OTHER }, { organizationId: OTHER }, { busy: true }, { connectionReady: false }, 'bill', 'register', 'unmount']) {
    const response = deferred(); const h = mounted({ billRegisters: async () => registers(), posBillDiagnostics: () => response.promise });
    h.input(POS); h.prepare(); await flush(); h.render(); h.consent(true); h.loadPos();
    if (change === 'bill') h.input(CLOUD);
    else if (change === 'register') h.choose(TABLE);
    else if (change === 'unmount') h.unmount();
    else h.render(change);
    response.resolve(loadedReport()); await flush(); assert.equal(h.states[1], null);
  }
});

test('scope, register and candidate changes consume the earlier loading consent', async () => {
  const h = mounted({ billRegisters: async () => registers(), posBillDiagnostics: () => assert.fail('expired consent must not dispatch') });
  h.input(POS); h.prepare(); await flush(); h.render(); h.consent(true); h.input(CLOUD); h.loadPos();
  assert.equal(h.states[6], null); h.consent(true); h.choose(TABLE); h.loadPos(); assert.equal(h.states[6], null);
});

test('changing a bill or register revokes consent before rendering and before passive effects run', async () => {
  for (const field of ['bill', 'register']) {
    const calls = [];
    const h = mounted({ billRegisters: async () => ({ ...registers(), registers: [...registers().registers,
      { id: TABLE, name: 'Інша каса', posVersion: '9.0.0', loadingSupported: true }] }),
      posBillDiagnostics: async (version, id, group) => {
        calls.push([version, id, group]);
        const value = loadedReport(); value.requestedId = id; value.order.posId = id;
        value.order.terminalGroupId = group; value.posLoading.terminalGroupId = group;
        return value;
      } });
    h.input(POS); h.prepare(); await flush(); h.render(); h.choose(OTHER); h.consent(true);
    const before = h.render();
    const oldLoad = button(before, 'Завантажити з каси та перевірити');
    assert.equal(oldLoad.props.disabled, false);
    if (field === 'bill') find(before, 'input').props.onChange({ target: { value: CLOUD } });
    else find(before, 'select').props.onChange({ target: { value: TABLE } });
    // The old render's handler must already be invalid, even before React commits.
    oldLoad.props.onClick(); assert.deepEqual(calls, []);
    const changed = h.renderBeforeEffects();
    const checkbox = all(changed, 'input').find(node => node.props.type === 'checkbox');
    const newLoad = button(changed, 'Завантажити з каси та перевірити');
    assert.equal(checkbox.props.checked, false); assert.equal(newLoad.props.disabled, true);
    newLoad.props.onClick(); await flush(); assert.deepEqual(calls, []);
    h.flushEffects(); h.render(); h.consent(true); h.loadPos(); await flush();
    assert.deepEqual(calls, [[VERSION, field === 'bill' ? CLOUD : POS, field === 'register' ? TABLE : OTHER]]);
    assert.equal(h.states[6], null);
  }
});

test('changing away and back before effects cannot restore an earlier POS confirmation', async () => {
  const h = mounted({ billRegisters: async () => registers(), posBillDiagnostics: () => assert.fail('revoked consent must not revive') });
  h.input(POS); h.prepare(); await flush(); h.render(); h.consent(true);
  let tree = h.renderBeforeEffects(); find(tree, 'input').props.onChange({ target: { value: CLOUD } });
  tree = h.renderBeforeEffects(); find(tree, 'input').props.onChange({ target: { value: POS } });
  tree = h.renderBeforeEffects();
  assert.equal(all(tree, 'input').find(node => node.props.type === 'checkbox').props.checked, false);
  const load = button(tree, 'Завантажити з каси та перевірити'); assert.equal(load.props.disabled, true);
  load.props.onClick(); await flush();
});

test('register metadata has bounded identities and versions and strips provider extras', () => {
  const { validateBillRegisters } = load();
  const value = registers(); value.privatePayload = 'private-body'; value.registers[0].secret = 'private-secret';
  assert.doesNotMatch(JSON.stringify(validateBillRegisters(value, scope())), /private-/);
  for (const mutate of [r => r.configurationRevision = OTHER, r => r.organizationId = OTHER, r => r.checkedAt = 'bad',
    r => r.registers.push(r.registers[0]), r => r.registers[0].id = '8', r => r.registers[0].name = '',
    r => r.registers[0].loadingSupported = 'true', r => r.registers[0].posVersion = null,
    r => r.registers[0].posVersion = 'private-version', r => r.registers = Array(101).fill(r.registers[0])]) {
    const value = registers(); mutate(value); assert.throws(() => validateBillRegisters(value, scope()), /Недійсний/);
  }
});

test('register version reasons are bounded, consistent with the version, and never retain upstream details', () => {
  const { validateBillRegisters } = load();
  for (const status of ['missing', 'null', 'empty', 'invalid_type', 'invalid_format']) {
    const value = registers(); Object.assign(value.registers[0], { posVersion: null, posVersionStatus: status,
      loadingSupported: false, upstreamBody: 'private-secret' });
    const checked = validateBillRegisters(value, scope());
    assert.equal(checked.registers[0].posVersionStatus, status); assert.doesNotMatch(JSON.stringify(checked), /private-/);
  }
  for (const status of ['private-secret', 'constructor', null, {}, ['valid'], 'missing']) {
    const value = registers(); value.registers[0].posVersionStatus = status;
    assert.throws(() => validateBillRegisters(value, scope()), /Недійсний/);
  }
  const value = registers(); Object.assign(value.registers[0], { posVersion: null, loadingSupported: false, posVersionStatus: 'valid' });
  assert.throws(() => validateBillRegisters(value, scope()), /Недійсний/);
  value.registers[0].posVersionStatus = ['missing'];
  assert.throws(() => validateBillRegisters(value, scope()), /Недійсний/);
});

test('version reasons are visible for unselectable registers and actual 8.8.8001.0 remains compatible', () => {
  const { validateBillRegisters, SyrveBillRegistersView } = load();
  for (const [status, message] of [['missing', /не передав поле/], ['null', /\(null\)/],
    ['empty', /порожній текст/], ['invalid_type', /типі даних/], ['invalid_format', /форматі, який MOLO не розпізнає/]]) {
    const value = registers(); Object.assign(value.registers[0], { posVersion: null, posVersionStatus: status, loadingSupported: false });
    const html = renderToStaticMarkup(React.createElement(SyrveBillRegistersView, { report: validateBillRegisters(value, scope()) }));
    assert.match(html, /Тестова каса/); assert.match(html, /Версія каси: невідома/); assert.match(html, message);
    assert.doesNotMatch(html, /Оновіть|private-|<button/);
  }
  const value = registers(); Object.assign(value.registers[0], { posVersion: '8.8.8001.0', posVersionStatus: 'valid' });
  const html = renderToStaticMarkup(React.createElement(SyrveBillRegistersView, { report: validateBillRegisters(value, scope()) }));
  assert.match(html, /8.8.8001.0/); assert.match(html, /Версія підтримує завантаження рахунків/);
});

test('older backend reports remain usable without inventing a reason for their null versions', () => {
  const { validateBillRegisters, SyrveBillRegistersView } = load();
  const value = registers(); Object.assign(value.registers[0], { posVersion: null, loadingSupported: false });
  const checked = validateBillRegisters(value, scope()); assert.equal(checked.registers[0].posVersionStatus, undefined);
  const html = renderToStaticMarkup(React.createElement(SyrveBillRegistersView, { report: checked }));
  assert.match(html, /Причину невідомої версії не отримано/); assert.doesNotMatch(html, /не передав поле|\(null\)/);
});

test('POS acknowledgements cannot be mixed with read-only or Cloud lookups or another chosen register', () => {
  const { validateBillDiagnostics } = load();
  const expected = { ...scope(), terminalGroupId: OTHER };
  assert.throws(() => validateBillDiagnostics(loadedReport(), scope()));
  for (const mutate of [r => delete r.posLoading, r => r.posLoading.requestAccepted = false,
    r => r.posLoading.terminalGroupId = TABLE, r => r.posLoading.terminalGroupName = '',
    r => r.posLoading.correlationId = 'bad', r => r.lookup = 'orderId',
    r => r.order.sum = '80', r => r.order.sum = -1, r => r.order.sum = Infinity]) {
    const value = loadedReport(); mutate(value); assert.throws(() => validateBillDiagnostics(value, expected), /Недійсний/);
  }
});

test('a POS acknowledgement shows amount and register comparison without proving occupancy or closure', () => {
  const { validateBillDiagnostics, SyrveBillDiagnosticsView } = load();
  const value = loadedReport(); value.posLoading.privatePayload = 'private-provider'; value.order.items = ['private-item'];
  const expected = { ...scope(), terminalGroupId: OTHER };
  let checked = validateBillDiagnostics(value, expected); assert.doesNotMatch(JSON.stringify(checked), /private-/);
  let html = renderToStaticMarkup(React.createElement(SyrveBillDiagnosticsView, { report: checked }));
  assert.match(html, /Сума рахунку: 80,00/); assert.match(html, /ще не підтверджує правильність UUID/);
  assert.doesNotMatch(html, /Вільний|private-/);
  value.order.terminalGroupId = TABLE;
  html = renderToStaticMarkup(React.createElement(SyrveBillDiagnosticsView, { report: validateBillDiagnostics(value, expected) }));
  assert.match(html, /Касова група у відповіді відрізняється/);
  const missing = { ...loadedReport(), found: false, order: null, lookup: null };
  html = renderToStaticMarkup(React.createElement(SyrveBillDiagnosticsView, { report: validateBillDiagnostics(missing, expected) }));
  assert.match(html, /не підтверджує закриття/); assert.match(html, /Статуси столів та зв’язки не змінено/);
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
