const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function flush() { for (let i = 0; i < 16; i++) await Promise.resolve(); }
function nodes(tree, predicate) {
  if (!tree || typeof tree !== 'object') return [];
  return [...(predicate(tree) ? [tree] : []),
    ...[tree.props?.children].flat(Infinity).flatMap(child => nodes(child, predicate))];
}
function text(tree) {
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  if (!tree || typeof tree !== 'object') return '';
  return [tree?.props?.children].flat(Infinity).map(text).join('');
}

// Exercise both real TSX components with deterministic hooks, timers and API replies.
// No added runtime dependency or live restaurant request is needed.
function mounted(componentName, state = {}) {
  state.status ??= 'free';
  state.requests = [];
  const values = [], refs = [], effects = [], queued = [], intervals = new Map();
  let stateIndex, refIndex, effectIndex, timerId = 0, tree;
  const hooks = {
    useState(initial) {
      const index = stateIndex++;
      if (!(index in values)) values[index] = typeof initial === 'function' ? initial() : initial;
      return [values[index], value => values[index] = typeof value === 'function' ? value(values[index]) : value];
    },
    useRef(initial) {
      const index = refIndex++;
      refs[index] ??= { current: initial };
      return refs[index];
    },
    useMemo(work) { return work(); },
    useEffect(work, deps) {
      const index = effectIndex++;
      const prior = effects[index];
      if (!prior || deps.length !== prior.deps.length || deps.some((value, i) => !Object.is(value, prior.deps[i]))) {
        effects[index] = { deps, cleanup: prior?.cleanup };
        queued.push(() => { effects[index].cleanup?.(); effects[index].cleanup = work(); });
      }
    },
  };
  const window = {
    setInterval(callback, delay) { const id = ++timerId; intervals.set(id, { callback, delay }); return id; },
    clearInterval(id) { intervals.delete(id); },
  };
  const zone = { id: 'zone-1', name: 'Зал ресторану', isVisible: true, isClosed: false };
  const table = () => ({ id: 'table-1', tableNumber: '1', seats: 4, isVisible: true, zone, status: state.status });
  const statusReply = (status, bookingDate) => ({ bookingDate, statuses: {
    '1': { tableId: 'table-1', tableNumber: '1', status, reason: null, conflict: null },
  } });
  const update = async (_tableId, status) => { state.status = status; };
  const apis = {
    '../api/map': { mapApi: { get: async () => ({ restaurant: { adminCanManageZones: true },
      zones: [zone], tables: [table()], mapIdentityPrepared: false }) } },
    '../api/bookings': { bookingsApi: {
      getByDate: async () => [],
      tableStatuses(query) {
        state.requests.push(query);
        return state.reply?.(query, state.requests.length) ?? Promise.resolve(statusReply(state.status, query.bookingDate));
      },
    } },
    '../api/availabilityBlocks': { availabilityBlocksApi: { list: async () => [] } },
    '../api/tables': { tablesApi: {
      free: id => update(id, 'free'), occupied: id => update(id, 'occupied'),
      cleaning: id => update(id, 'cleaning'), close: id => update(id, 'closed'),
      setStatus: update,
    } },
  };
  const modules = new Map();
  function load(file) {
    if (modules.has(file)) return modules.get(file);
    const exports = {};
    modules.set(file, exports);
    const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX,
    } }).outputText;
    vm.runInNewContext(output, { exports, window, require(id) {
      if (id === 'react') return hooks;
      if (apis[id]) return apis[id];
      if (id.startsWith('.')) {
        const target = path.resolve(path.dirname(file), id);
        return load(fs.existsSync(`${target}.ts`) ? `${target}.ts` : `${target}.tsx`);
      }
      return require(id);
    } }, { filename: file });
    return exports;
  }
  const component = load(path.resolve(__dirname, `../src/admin/${componentName}.tsx`)).default;
  function flushEffects() { while (queued.length) queued.shift()(); }
  function render(runEffects = true) {
    stateIndex = refIndex = effectIndex = 0;
    tree = component({ onClose() {} });
    if (runEffects) flushEffects();
    return tree;
  }
  function input(type) { return nodes(render(), node => node.type === 'input' && node.props.type === type)[0]; }
  const h = {
    state, intervals, statusReply, render, flushEffects,
    date: () => input('date').props.value,
    change(type, value, runEffects = true) {
      input(type).props.onChange({ target: { value } });
      render(runEffects);
    },
    refresh() { nodes(render(), node => node.type === 'button')[0].props.onClick(); },
    async tick() { for (const timer of intervals.values()) timer.callback(); await flush(); render(); },
    select() {
      const node = componentName === 'AdminVisualTablePlanner'
        ? nodes(render(), node => node.props?.label === 'Стіл 1')[0]
        : nodes(render(), node => node.type === 'button' && text(node).startsWith('№1'))[0];
      assert.ok(node, 'the physical table remains selectable');
      node.props.onClick(); render();
    },
    action(label) {
      const node = nodes(render(), node => node.type === 'button' && text(node) === label)[0];
      assert.ok(node, `${label} must remain available`);
      node.props.onClick();
    },
    deselect() {
      const panel = nodes(render(), node => Object.hasOwn(node.props || {}, 'data-map-target'))[0];
      assert.ok(panel);
      nodes(panel, node => node.type === 'button')[0].props.onClick();
      render();
    },
    status(runEffects = true) {
      if (componentName === 'AdminVisualTablePlanner') {
        return nodes(render(runEffects), node => node.props?.label === 'Стіл 1')[0]?.props.color;
      }
      return text(nodes(render(runEffects), node => node.type === 'button' && text(node).startsWith('№1'))[0]);
    },
    unmount() { effects.forEach(effect => effect.cleanup?.()); },
  };
  render();
  return h;
}

for (const component of ['AdminTablesByLocation', 'AdminVisualTablePlanner']) {
  const expectedFree = component === 'AdminVisualTablePlanner' ? 'transparent' : '№1Вільний4 місць';
  test(`${component} refreshes external occupancy every 15 seconds and stops on close`, async () => {
    const h = mounted(component); await flush();
    assert.equal(h.status(), expectedFree);
    assert.equal(h.intervals.size, 1);
    assert.equal([...h.intervals.values()][0].delay, 15_000);
    h.state.status = 'occupied';
    await h.tick();
    assert.equal(h.state.requests.length, 2);
    assert.equal(h.status(), component === 'AdminVisualTablePlanner' ? '#ff3b4f' : '№1Зайнятий4 місць');
    h.unmount();
    assert.equal(h.intervals.size, 0);
    await h.tick();
    assert.equal(h.state.requests.length, 2);
  });

  for (const field of ['date', 'time']) {
    test(`${component} ignores a late response after ${field} changes`, async () => {
      const held = deferred();
      const h = mounted(component, { reply: (_query, count) => count === 1 ? held.promise : undefined });
      const oldQuery = h.state.requests[0];
      h.change(field, field === 'date' ? '2099-05-01' : '21:00');
      await flush();
      assert.equal(h.state.requests.length, 2);
      assert.equal(h.status(), expectedFree);
      held.resolve(h.statusReply('occupied', oldQuery.bookingDate));
      await flush();
      assert.equal(h.status(), expectedFree);
      h.unmount();
    });
  }

  test(`${component} rejects a stale reply even before the new date effect runs`, async () => {
    const held = deferred();
    const h = mounted(component, { reply: (_query, count) => count === 1 ? held.promise : undefined });
    h.change('date', '2099-05-01', false);
    held.resolve(h.statusReply('occupied', h.state.requests[0].bookingDate));
    await flush();
    assert.equal(h.status(false), component === 'AdminVisualTablePlanner' ? undefined : '');
    h.flushEffects(); await flush();
    assert.equal(h.status(), expectedFree);
    h.unmount();
  });

  test(`${component} skips overlapping polls and preserves a newer manual action`, async () => {
    const held = deferred();
    const h = mounted(component, { reply: (_query, count) => count === 2 ? held.promise : undefined });
    await flush();
    await h.tick(); await h.tick();
    assert.equal(h.state.requests.length, 2, 'a slow read must not multiply polling requests');
    h.select(); h.action('Готується'); await flush();
    assert.equal(h.state.requests.length, 3, 'an explicit action refreshes despite the pending poll');
    held.resolve(h.statusReply('free', h.date())); await flush();
    // Selected planner outlines are yellow; close the selection to inspect its status color.
    if (component === 'AdminVisualTablePlanner') h.deselect();
    assert.equal(h.status(), component === 'AdminVisualTablePlanner' ? '#67e8f9' : '№1Готується4 місць');
    h.unmount();
  });

  test(`${component} ignores stale errors and clears the loading state of the current request`, async () => {
    const held = deferred();
    const h = mounted(component, { reply: (_query, count) => count === 1 ? held.promise : undefined });
    h.change('date', '2099-05-01'); await flush();
    held.reject(new Error('old-date-error')); await flush();
    assert.doesNotMatch(text(h.render()), /old-date-error/);
    const refresh = nodes(h.render(), node => node.type === 'button')[0];
    const icon = nodes(refresh, node => node.props?.size === 18)[0];
    assert.equal(icon.props.className, '');
    h.unmount();
  });

  test(`${component} invalidates an in-flight reply when the screen closes`, async () => {
    const held = deferred();
    const h = mounted(component, { reply: () => held.promise });
    h.unmount(); held.resolve(h.statusReply('occupied', h.state.requests[0].bookingDate));
    await flush();
    assert.equal(h.status(), component === 'AdminVisualTablePlanner' ? undefined : '');
    assert.equal(h.intervals.size, 0);
  });
}

test('planner polling keeps the selected table and an unfinished reason', async () => {
  const h = mounted('AdminVisualTablePlanner'); await flush();
  h.select();
  const reason = nodes(h.render(), node => node.type === 'textarea')[0];
  reason.props.onChange({ target: { value: 'Підготовка до свята' } });
  await h.tick();
  assert.equal(h.status(), '#facc15');
  assert.equal(nodes(h.render(), node => node.type === 'textarea')[0].props.value, 'Підготовка до свята');
  h.unmount();
});
