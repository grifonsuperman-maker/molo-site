const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const test = require('node:test');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const root = path.resolve(__dirname, '../src');
const guest = 'guest/GuestApp.tsx';
const admin = 'admin/AdminVisualTablePlanner.tsx';
function nodeSource(file, predicate) {
  const parsed = ts.createSourceFile(file, fs.readFileSync(path.join(root, file), 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const matches = [];
  function visit(node) {
    if (predicate(node, parsed)) matches.push(node.getText(parsed));
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  assert.equal(matches.length, 1, file);
  return matches[0];
}
function compile(source, result, dependencies = {}) {
  const js = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React,
  } }).outputText;
  return new Function(...Object.keys(dependencies), `${js}\nreturn ${result};`)(...Object.values(dependencies));
}
const helpers = compile(fs.readFileSync(path.join(root, 'services/tableMapIdentity.ts'), 'utf8'), 'exports', { exports: {} });
function callable(file, name, dependencies) {
  return compile(nodeSource(file, (node) => ts.isFunctionDeclaration(node) && node.name?.text === name), name, dependencies);
}
function value(file, name, dependencies = {}) {
  return compile('const ' + nodeSource(file, (node) => ts.isVariableDeclaration(node) && node.name.getText() === name) + ';', name, dependencies);
}
const table = (id, number, mapKey, extra = {}) => ({ id, tableNumber: String(number),
  ...(mapKey === undefined ? {} : { mapKey }), status: 'free', isVisible: true, seats: 4, ...extra });
const renamed = table('original-12', 77, 'hall:12');
const reusedNumber = table('original-15', 12, 'canopy:15');
const unbound = table('unbound', 14, null);

test('all 60 frozen slots still match both maps; geometry and image paths match merged PR4a', () => {
  const hashes = {
    [guest]: '0fa112eabf80af7b4857e5b0a5ffcdf9f6b24ab27f3bfea45286338594a5ceae',
    [admin]: 'd4175f6dc0733c4f09f9df38babfaf5249f8f607cc275b10ea8250b3496d590b',
  };
  for (const file of [guest, admin]) {
    const source = nodeSource(file, (node) => ts.isVariableDeclaration(node) && node.name.getText() === 'LOCATIONS');
    const initializer = source.slice(source.indexOf('=') + 1).trim();
    assert.equal(crypto.createHash('sha256').update(initializer).digest('hex'), hashes[file]);
    const locations = value(file, 'LOCATIONS');
    assert.equal(locations.reduce((sum, location) => sum + location.tables.length, 0), 60);
    for (const location of locations) for (const slot of location.tables) {
      assert.deepEqual(helpers.physicalMapSlot(`${location.key}:${slot.number}`), {
        key: `${location.key}:${slot.number}`, location: location.key, number: slot.number,
      });
    }
  }
});

test('prepared UUID lookup ignores renaming, reused numbers, missing, invalid and duplicate identities', () => {
  const rows = [renamed, reusedNumber, unbound];
  assert.equal(helpers.findTableForMapSlot(rows, 'hall', 12), renamed);
  assert.equal(helpers.findTableForMapSlot(rows, 'canopy', 15), reusedNumber);
  assert.equal(helpers.findTableForMapSlot(rows, 'hall', 14), null);
  assert.equal(helpers.findTableForMapSlot([table('wrong', 12, 'hall:77')], 'hall', 12), null);
  assert.equal(helpers.findTableForMapSlot([renamed, { ...renamed, id: 'duplicate' }], 'hall', 12), null);
  assert.equal(helpers.findTableForMapSlot([table('partial-legacy', 12)], 'hall', 12, true), null);
  assert.equal(helpers.findTableForMapSlot([], 'hall', 12, true), null);
  assert.equal(helpers.tableMapLocation(renamed, true), 'hall');
  assert.equal(helpers.tableMapLocation(unbound, true), null);
  assert.equal(helpers.physicalMapSlot('__proto__:12'), null);
  assert.equal(helpers.physicalMapSlot('hall:012'), null);
  const legacy = table('legacy', 12);
  assert.equal(helpers.findTableForMapSlot([legacy], 'hall', 12), legacy);
  assert.equal(helpers.tableMapLocation(legacy, false), 'hall');
});

test('both connected location panels retain physical groups, hidden filtering and an unassigned list', () => {
  for (const file of ['waiter/WaiterTablesByLocation.tsx', 'admin/AdminTablesByLocation.tsx']) {
    const rows = [renamed, reusedNumber, unbound, table('hidden', 13, 'hall:13', { isVisible: false }),
      table('water', 45, 'water_gazebo:100'), table('partial', 16)];
    const deps = { tables: rows, fullMap: { tables: rows, mapIdentityPrepared: true },
      mapIdentityPrepared: true, LOCATIONS: value(file, 'LOCATIONS'), useMemo: (read) => read(), ...helpers };
    const groups = value(file, 'locationGroups', deps);
    assert.deepEqual(groups.find((group) => group.key === 'hall').tables.map((row) => row.id), ['original-12']);
    assert.deepEqual(groups.find((group) => group.key === 'canopy').tables.map((row) => row.id), ['original-15']);
    assert.deepEqual(groups.find((group) => group.key === 'water-gazebo').tables.map((row) => row.id), ['water']);
    assert.deepEqual(value(file, 'unassignedTables', deps).map((row) => row.id), ['unbound', 'partial']);
    const legacy = [table('legacy-12', 12), table('legacy-15', 15), table('extra', 999)];
    const legacyDeps = { ...deps, tables: legacy, fullMap: { tables: legacy }, mapIdentityPrepared: false };
    assert.deepEqual(value(file, 'locationGroups', legacyDeps).find((group) => group.key === 'hall').tables.map((row) => row.id), ['legacy-12']);
    assert.deepEqual(value(file, 'unassignedTables', legacyDeps).map((row) => row.id), ['extra']);
  }
});

function guestHarness(rows, prepared = true) {
  const state = { selected: null, fallback: 0, active: null, delays: [] };
  const deps = { ...helpers, visibleTables: rows.filter((row) => row.isVisible !== false),
    currentLocation: { key: 'hall' }, selectedLocationKey: 'hall', mapIdentityPrepared: prepared,
    getRuntimeStatus: (number) => ({ status: String(number) === '77' ? 'pending' : 'occupied' }),
    normalizeTableStatus: (status) => status || 'free', isLocationClosed: () => false,
    restaurant: { status: 'open' }, setTableNotice() {},
    setActiveTableNumber: (number) => state.active = number,
    getSelectableTableStatus: () => 'free', selectTable: (row) => state.selected = row,
    createFallbackTable: (number, seats) => { state.fallback++; return table('visual-' + number, number, undefined, { seats }); },
    window: { setTimeout: (callback, delay) => { state.delays.push(delay); callback(); } } };
  deps.findRealTableForSlot = callable(guest, 'findRealTableForSlot', deps);
  return { state, deps };
}

test('actual guest click selects the stable UUID; prepared missing/hidden slots cannot synthesize bookings', () => {
  const h = guestHarness([renamed, reusedNumber, unbound]);
  callable(guest, 'selectVisualTable', h.deps)({ number: 12, seats: 4 });
  assert.equal(h.state.selected, renamed);
  assert.equal(h.state.active, 12);
  assert.deepEqual(h.state.delays, [650]);
  assert.equal(h.state.fallback, 0);
  assert.equal(callable(guest, 'getVisualTableStatus', h.deps)(12), 'pending', 'runtime status uses current 77, not frozen 12');
  for (const rows of [[], [unbound], [{ ...renamed, isVisible: false }], [reusedNumber]]) {
    const missing = guestHarness(rows);
    callable(guest, 'selectVisualTable', missing.deps)({ number: 12, seats: 4 });
    assert.equal(missing.state.selected, null);
    assert.equal(missing.state.fallback, 0);
    assert.deepEqual(missing.state.delays, []);
  }
  const legacy = guestHarness([], false);
  callable(guest, 'selectVisualTable', legacy.deps)({ number: 12, seats: 4 });
  assert.equal(legacy.state.selected.id, 'visual-12');
  assert.equal(legacy.state.fallback, 1);
});

function renderSlot(file, expression, deps, slot) {
  const source = nodeSource(file, (node, parsed) => ts.isCallExpression(node) && node.expression.getText(parsed) === expression);
  return compile(`const render = ${source.slice(source.indexOf('(') + 1, -1)};`, 'render', { React, ...deps })(slot);
}

test('connected map renderers show current labels and act on the original UUID without moving the contour', () => {
  const rows = [renamed, reusedNumber];
  const realTable = callable(admin, 'realTable', { ...helpers, map: { tables: rows, mapIdentityPrepared: true }, location: { key: 'hall' } });
  const color = callable(admin, 'tableColor', { realTable, target: null, statuses: { '77': { status: 'pending' }, '12': { status: 'occupied' } } });
  let target;
  const slot = value(admin, 'LOCATIONS')[0].tables.find((row) => row.number === 12);
  const shape = renderSlot(admin, 'location.tables.map', { realTable, tableColor: color, target: null,
    canManage: true, setTarget: (value) => target = value,
    Shape: (props) => React.createElement('button', { 'aria-label': props.label }) }, slot);
  assert.equal(shape.props.shape, slot.shape);
  assert.equal(shape.props.color, '#38bdf8');
  assert.match(renderToStaticMarkup(shape), /Стіл 77/);
  shape.props.onClick();
  assert.deepEqual(target, { type: 'table', id: 'original-12' });
  const h = guestHarness(rows);
  h.deps.getVisualTableStatus = callable(guest, 'getVisualTableStatus', h.deps);
  const props = { ...h.deps, getTableNeonColor: () => '#38bdf8', activeTableNumber: null,
    selectVisualTable() {}, VisibleContour: () => null,
    ClickZone: ({ tableNumber }) => React.createElement('button', { 'aria-label': 'Стіл ' + tableNumber }) };
  assert.match(renderToStaticMarkup(renderSlot(guest, 'currentLocation.tables.map', props, slot)), /Стіл 77/);
  assert.equal(renderSlot(guest, 'currentLocation.tables.map', { ...props, findRealTableForSlot: () => null }, slot), null);
});

async function revalidate(rows, selectedTable, statuses = {}) {
  const state = { notices: [], alerts: [], selected: null, active: null };
  const deps = { ...helpers, selectedTable, selectedLocationKey: 'hall', date: '2026-10-01', time: '19:00',
    durationMinutes: 120, bookingEndTime: '21:00', availableAfterCleanup: '21:15',
    bookingsApi: { tableStatuses: async () => ({ statuses }) },
    mapApi: { get: async () => ({ tables: rows, zones: [], mapIdentityPrepared: true }) },
    restaurantApi: { get: async () => ({ status: 'open' }) },
    getMapFromResponse: (value) => value, getRestaurantFromResponse: (value) => value,
    findLocationZone: () => null, normalizeTableStatus: (value) => value || 'free',
    setDateStatuses() {}, setMap() {}, setRestaurant() {}, setStep() {},
    setSelectedTable: (value) => state.selected = value,
    setActiveTableNumber: (value) => state.active = value,
    setTableNotice: (value) => state.notices.push(value), alert: (message) => state.alerts.push(message) };
  return { state, result: await callable(guest, 'revalidateSelectedTableBeforeSubmit', deps)() };
}

test('guest submit revalidation follows UUID, checks current-number status and requires acknowledgement after rename', async () => {
  const selected = { ...renamed, tableNumber: '12' };
  const blocked = await revalidate([renamed, reusedNumber], selected, { '77': { status: 'occupied' }, '12': { status: 'free' } });
  assert.equal(blocked.result, false);
  assert.equal(blocked.state.notices[0].tableNumber, '77');
  assert.equal(blocked.state.active, 12, 'unavailable highlight stays on the original physical contour');
  const changed = await revalidate([renamed, reusedNumber], selected, { '77': { status: 'free' } });
  assert.equal(changed.result, false);
  assert.equal(changed.state.selected.id, selected.id);
  assert.equal(changed.state.selected.tableNumber, '77');
  assert.equal((await revalidate([renamed, reusedNumber], changed.state.selected, { '77': { status: 'free' } })).result, true);
  for (const rows of [[reusedNumber], [{ ...renamed, isVisible: false }], [{ ...renamed, mapKey: null }]]) {
    assert.equal((await revalidate(rows, selected)).result, false);
  }
});

test('waiter status response preserves physical identity while sending exactly the existing UUID and status', async () => {
  const rows = [renamed];
  let input;
  await callable('waiter/WaiterTablesByLocation.tsx', 'setStatus', {
    setBusy() {}, setNotice() {}, setError() {}, STATUS_LABELS: { occupied: 'Зайнятий' },
    tablesApi: { waiterStatus: async (id, status) => { input = [id, status]; return { id, tableNumber: '77', status }; } },
    setTables: (update) => rows.splice(0, rows.length, ...update(rows)), load: async () => {},
  })(renamed, 'occupied');
  assert.deepEqual(input, ['original-12', 'occupied']);
  assert.equal(rows[0].status, 'occupied');
  assert.equal(rows[0].mapKey, 'hall:12');
  assert.equal(helpers.tableMapLocation(rows[0], true), 'hall');
});
