const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const REV = 'a0000000-0000-4000-8000-000000000001';
const ORG = 'a0000000-0000-4000-8000-000000000003';
const saved = (changes = {}) => ({
  id: 'saved-integration', displayName: 'Збережене підключення',
  apiBaseUrl: 'https://api-eu.syrve.live', apiLoginMasked: '••••abcd',
  hasCredentials: true, organizationId: ORG, organizationName: 'Ресторан MOLO',
  status: 'connected', lastCheckedAt: '2026-10-03T09:00:00.000Z',
  connectedAt: '2026-10-03T08:00:00.000Z', lastError: null,
  configurationRevision: REV, settingsPrepared: true, confirmedLinks: 2,
  syncEnabled: false, ...changes,
});
const unavailable = () => { throw new Error('private-network-details'); };
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function find(node, predicate) {
  if (!node || typeof node !== 'object') return null;
  if (predicate(node)) return node;
  for (const child of [node.props?.children].flat(Infinity)) {
    const found = find(child, predicate);
    if (found) return found;
  }
  return null;
}
function text(node) {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (!node || typeof node !== 'object') return '';
  return [node?.props?.children].flat(Infinity).map(text).join('');
}
function mounted(reads, commands = {}) {
  const requests = [], states = [], refs = [], effectSlots = [], effects = [];
  let stateIndex = 0, refIndex = 0, effectIndex = 0;
  const api = new Proxy({
    getStatus: async () => {
      requests.push('getStatus');
      assert.ok(reads.length, 'unexpected status request');
      const value = reads.shift();
      return typeof value === 'function' ? value() : value;
    }, ...commands,
  }, {
    get(target, name) {
      if (name in target) return target[name];
      return () => assert.fail(`unrequested Syrve operation: ${String(name)}`);
    },
  });
  const react = {
    useState(initial) {
      const index = stateIndex++;
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
      return [states[index], value => {
        states[index] = typeof value === 'function' ? value(states[index]) : value;
      }];
    },
    useRef(initial) {
      const index = refIndex++;
      if (!(index in refs)) refs[index] = { current: initial };
      return refs[index];
    },
    useEffect(effect, dependencies) {
      const index = effectIndex++, previous = effectSlots[index];
      if (!previous || dependencies.some((value, i) => !Object.is(value, previous.dependencies[i]))) {
        effects.push(() => {
          previous?.cleanup?.();
          effectSlots[index] = { dependencies, cleanup: effect() };
        });
      }
    },
  };
  const panels = new Map();
  const exports = {};
  const source = fs.readFileSync(path.resolve(__dirname, '../src/director/SyrveIntegrationDock.tsx'), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, {
    exports,
    window: { prompt: () => 'Зміна налаштувань', confirm: () => true },
    require(name) {
      if (name === 'react') return react;
      if (name === '../api/syrve') return { syrveApi: api };
      if (name === './services/syrveOperationErrors') {
        const helpers = {}, helperSource = fs.readFileSync(path.resolve(__dirname, '../src/director/services/syrveOperationErrors.ts'), 'utf8');
        vm.runInNewContext(ts.transpileModule(helperSource, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: helpers });
        return helpers;
      }
      if (name.startsWith('./Syrve')) {
        const panel = name.slice(2);
        if (!panels.has(panel)) {
          const component = () => React.createElement('div', { 'data-panel': panel });
          component.displayName = panel;
          panels.set(panel, component);
        }
        return { default: panels.get(panel) };
      }
      return require(name);
    },
  });
  const render = () => {
    stateIndex = refIndex = effectIndex = 0;
    const tree = exports.default();
    while (effects.length) effects.shift()();
    return tree;
  };
  const button = label => find(render(), node => node.type === 'button' && text(node) === label);
  const dock = () => render().props.children[0];
  return {
    requests, render, button, dock,
    html: () => renderToStaticMarkup(render()),
    ready: async () => { render(); await flush(); render(); },
    open: async () => { dock().props.onClick(); await flush(); render(); },
    close: () => {
      find(render(), node => node.props?.['aria-label'] === 'Закрити налаштування Syrve').props.onClick();
      render();
    },
    click: async label => {
      const control = button(label);
      assert.ok(control, label);
      assert.ok(!control.props.disabled, `${label} is disabled`);
      control.props.onClick();
      await flush();
      render();
    },
    panel: name => find(render(), node => node.type?.displayName === name),
    unmount: () => effectSlots.forEach(slot => slot.cleanup?.()),
  };
}

test('failed refresh keeps saved connection visible and blocks actions until retry succeeds', async () => {
  const h = mounted([saved(), unavailable, saved({ displayName: 'Оновлене підключення' })]);
  await h.ready();
  await h.open();
  let html = h.html();
  assert.match(html, /Збережене підключення/);
  assert.match(html, /Ресторан MOLO/);
  assert.match(html, /••••abcd/);
  assert.match(html, /Не вдалося оновити стан Syrve/);
  assert.match(html, /останній підтверджений стан/);
  assert.doesNotMatch(html, /private-network-details|API-логін \/ ключ/);
  for (const label of ['Перевірити', 'Змінити дані', 'Відключити']) {
    const button = h.button(label);
    assert.ok(button, label);
    assert.equal(button.props.disabled, true, label);
    button.props.onClick();
  }
  await flush();
  assert.equal(h.panel('SyrveAutoStatusPanel'), null);
  assert.deepEqual(h.requests, ['getStatus', 'getStatus']);
  await h.click('Спробувати ще раз');
  html = h.html();
  assert.match(html, /Оновлене підключення/);
  assert.doesNotMatch(html, /Не вдалося оновити стан Syrve/);
  assert.equal(h.button('Перевірити').props.disabled, false);
  assert.equal(h.panel('SyrveAutoStatusPanel').props.configurationRevision, REV);
});

test('activation failure reason survives the required refresh and replacement panel', async () => {
  const next = 'a0000000-0000-4000-8000-000000000002', reason = 'Syrve не надав права для цієї перевірки.';
  const h = mounted([saved(), saved(), saved({ configurationRevision: next })]);
  await h.ready(); await h.open();
  await h.panel('SyrveAutoStatusPanel').props.onFinished('failed', reason);
  assert.match(h.html(), /Syrve не надав права для цієї перевірки/);
  assert.equal(h.panel('SyrveAutoStatusPanel').props.configurationRevision, next);
  assert.equal(h.panel('SyrveAutoStatusPanel').props.syncEnabled, false);
  assert.doesNotMatch(h.html(), /Автоматичні статуси столів увімкнено/);
});

test('failed loading receipt reason survives the new saved revision', async () => {
  const next = 'a0000000-0000-4000-8000-000000000002';
  const h = mounted([saved(), saved(), saved({ configurationRevision: next })]);
  await h.ready(); await h.open();
  await h.panel('SyrveTableLoadingPanel').props.onFinished({ readCompleted: false, code: 'SYRVE_ACCESS_DENIED' });
  assert.match(h.html(), /Syrve не надав права для цієї перевірки/);
  assert.equal(h.panel('SyrveTableLoadingPanel').props.configurationRevision, next);
  assert.doesNotMatch(h.html(), /Syrve підтвердив завантаження стану столів/);
});

test('known operation failure stays visible when the follow-up status read also fails', async () => {
  for (const panelName of ['SyrveTableLoadingPanel', 'SyrveAutoStatusPanel']) {
    const h = mounted([saved(), saved(), unavailable]); await h.ready(); await h.open();
    await h.panel(panelName).props.onFinished(panelName === 'SyrveAutoStatusPanel' ? 'failed' : null,
      'Syrve не надав права для цієї перевірки.');
    assert.match(h.html(), /Syrve не надав права для цієї перевірки/);
    assert.match(h.html(), /Не вдалося оновити стан Syrve/);
    assert.doesNotMatch(h.html(), /private-network-details|Автоматичні статуси столів увімкнено|Syrve підтвердив завантаження/);
  }
});

test('private operation details are never retained by the parent dock', async () => {
  for (const panelName of ['SyrveTableLoadingPanel', 'SyrveAutoStatusPanel']) {
    const h = mounted([saved(), saved(), saved()]); await h.ready(); await h.open();
    await h.panel(panelName).props.onFinished(panelName === 'SyrveAutoStatusPanel' ? 'failed' : null,
      'Syrve не надав права для цієї перевірки. apiKey=private-api-secret');
    assert.doesNotMatch(h.html(), /private-api-secret|apiKey/);
  }
});

test('starting the next operation clears a previous reason while keeping the saved connection', async () => {
  for (const panelName of ['SyrveTableLoadingPanel', 'SyrveAutoStatusPanel']) {
    const h = mounted([saved(), saved(), saved()]); await h.ready(); await h.open();
    await h.panel(panelName).props.onFinished(panelName === 'SyrveAutoStatusPanel' ? 'failed' : null,
      'Syrve не надав права для цієї перевірки.');
    assert.match(h.html(), /Syrve не надав права для цієї перевірки/);
    h.panel(panelName).props.onBusyChange(true);
    assert.doesNotMatch(h.html(), /Syrve не надав права для цієї перевірки/);
    assert.match(h.html(), /Збережене підключення/);
  }
});

test('a late operation refresh cannot replace the current failure reason', async () => {
  for (const panelName of ['SyrveTableLoadingPanel', 'SyrveAutoStatusPanel']) {
    const old = deferred(), latest = deferred();
    const h = mounted([saved(), saved(), () => old.promise, () => latest.promise]);
    await h.ready(); await h.open();
    const finish = h.panel(panelName).props.onFinished, outcome = panelName === 'SyrveAutoStatusPanel' ? 'failed' : null;
    const first = finish(outcome, 'Syrve не надав права для цієї перевірки.');
    const second = finish(outcome, 'Syrve тимчасово обмежив кількість запитів. Спробуйте пізніше.');
    latest.resolve(saved()); await second;
    old.reject(new Error('private-outdated-status')); await first;
    assert.match(h.html(), /Syrve тимчасово обмежив кількість запитів/);
    assert.doesNotMatch(h.html(), /Syrve не надав права|private-outdated-status/);
  }
});

test('first failed read is unknown and cannot open a new connection form', async () => {
  const h = mounted([unavailable, unavailable, saved()]);
  await h.ready();
  assert.match(h.dock().props['aria-label'], /невідомий/);
  await h.open();
  assert.match(h.html(), /Стан підключення невідомий/);
  assert.doesNotMatch(h.html(), /API-логін \/ ключ|Поточне підключення/);
  assert.equal(h.panel('SyrveAutoStatusPanel'), null);
  await h.click('Спробувати ще раз');
  assert.match(h.html(), /Збережене підключення/);
  assert.doesNotMatch(h.html(), /Стан підключення невідомий|API-логін \/ ключ/);
  assert.deepEqual(h.requests, ['getStatus', 'getStatus', 'getStatus']);
});

test('new connection form opens only after a successful not-connected response', async () => {
  const h = mounted([unavailable, unavailable, saved({
    hasCredentials: false, status: 'not_connected', organizationId: null,
    organizationName: null, apiLoginMasked: null, confirmedLinks: 0,
  })]);
  await h.ready();
  await h.open();
  assert.doesNotMatch(h.html(), /API-логін \/ ключ/);
  await h.click('Спробувати ще раз');
  assert.match(h.html(), /API-логін \/ ключ/);
  assert.doesNotMatch(h.html(), /Стан підключення невідомий|Не вдалося оновити стан Syrve/);
});

test('pending first load does not claim the connection is absent', async () => {
  const first = deferred(), latest = deferred();
  const h = mounted([() => first.promise, () => latest.promise]);
  await h.ready();
  assert.match(h.dock().props['aria-label'], /Перевіряємо/);
  await h.open();
  assert.match(h.html(), /Оновлюємо стан Syrve/);
  assert.doesNotMatch(h.html(), /API-логін \/ ключ|Поточне підключення/);
  latest.resolve(saved());
  await flush();
  first.reject(new Error('private-old-request'));
  await flush();
  assert.match(h.html(), /Збережене підключення/);
  assert.doesNotMatch(h.html(), /Не вдалося оновити стан Syrve|private-old-request/);
});

test('retry retains the saved summary while pending and does not resubmit any command', async () => {
  const pending = deferred();
  const h = mounted([saved(), unavailable, () => pending.promise]);
  await h.ready();
  await h.open();
  await h.click('Спробувати ще раз');
  assert.match(h.html(), /Оновлюємо стан Syrve/);
  assert.match(h.html(), /Збережене підключення/);
  assert.equal(h.button('Відключити').props.disabled, true);
  pending.resolve(saved());
  await flush();
  assert.doesNotMatch(h.html(), /Не вдалося оновити стан Syrve|Оновлюємо стан Syrve/);
  assert.equal(h.button('Відключити').props.disabled, false);
  assert.deepEqual(h.requests, ['getStatus', 'getStatus', 'getStatus']);
});

test('closing and reopening ignores old status successes and failures', async () => {
  for (const fail of [false, true]) {
    const old = deferred();
    const h = mounted([saved(), () => old.promise, saved({ displayName: 'Нове підключення' })]);
    await h.ready();
    await h.open();
    find(h.render(), node => node.props?.['aria-label'] === 'Закрити налаштування Syrve').props.onClick();
    await h.open();
    if (fail) old.reject(new Error('private-stale-response'));
    else old.resolve(saved({ displayName: 'Старе підключення' }));
    await flush();
    assert.match(h.html(), /Нове підключення/);
    assert.doesNotMatch(h.html(), /Старе підключення|Не вдалося оновити стан Syrve|private-stale-response/);
  }
});

test('cancelling a settings read restores cached ready state immediately and ignores its late result', async () => {
  for (const fail of [false, true]) {
    const pending = deferred();
    const h = mounted([saved(), () => pending.promise]);
    await h.ready();
    await h.open();
    assert.equal(h.dock().props['aria-busy'], true);
    h.close();
    assert.equal(h.dock().props['aria-busy'], false);
    assert.match(h.dock().props['aria-label'], /Syrve підключено/);
    if (fail) pending.reject(new Error('private-cancelled-read'));
    else pending.resolve(saved({ organizationName: 'Застаріла організація' }));
    await flush();
    assert.equal(h.dock().props['aria-busy'], false);
    assert.match(h.dock().props.title, /Ресторан MOLO/);
    assert.doesNotMatch(h.html(), /Застаріла організація|private-cancelled-read/);
    assert.deepEqual(h.requests, ['getStatus', 'getStatus']);
  }
});

test('cancelling a retry restores prior error instead of claiming the cached connection was checked', async () => {
  for (const fail of [false, true]) {
    const pending = deferred();
    const h = mounted([saved(), unavailable, () => pending.promise, saved()]);
    await h.ready();
    await h.open();
    await h.click('Спробувати ще раз');
    h.close();
    assert.equal(h.dock().props['aria-busy'], false);
    assert.match(h.dock().props['aria-label'], /невідомий/);
    if (fail) pending.reject(new Error('private-cancelled-retry'));
    else pending.resolve(saved());
    await flush();
    assert.equal(h.dock().props['aria-busy'], false);
    assert.match(h.dock().props['aria-label'], /невідомий/);
    await h.open();
    assert.match(h.html(), /Збережене підключення/);
    assert.doesNotMatch(h.html(), /Не вдалося оновити стан Syrve/);
  }
});

test('cancelling the first status read stays unknown without an active loading indicator', async () => {
  const initial = deferred(), opened = deferred();
  const h = mounted([() => initial.promise, () => opened.promise]);
  await h.ready();
  await h.open();
  h.close();
  assert.equal(h.dock().props['aria-busy'], false);
  assert.match(h.dock().props['aria-label'], /невідомий/);
  initial.resolve(saved());
  opened.reject(new Error('private-first-cancelled-read'));
  await flush();
  assert.equal(h.dock().props['aria-busy'], false);
  assert.match(h.dock().props['aria-label'], /невідомий/);
  assert.doesNotMatch(h.html(), /Підключити Syrve|private-first-cancelled-read/);
});

test('cancelling a post-operation refresh restores cached state without repeating the operation', async () => {
  for (const panelName of ['SyrveAutoStatusPanel', 'SyrveTableLoadingPanel']) {
    for (const fail of [false, true]) {
      const pending = deferred();
      const h = mounted([saved(), saved(), () => pending.promise]);
      await h.ready();
      await h.open();
      const panel = h.panel(panelName);
      panel.props.onBusyChange(true);
      const refresh = panel.props.onFinished(panelName === 'SyrveAutoStatusPanel' ? 'enabled' : { readCompleted: true });
      await flush();
      assert.equal(h.dock().props['aria-busy'], true);
      h.close();
      assert.equal(h.dock().props['aria-busy'], false);
      assert.match(h.dock().props['aria-label'], /Syrve підключено/);
      if (fail) pending.reject(new Error('private-cancelled-operation-refresh'));
      else pending.resolve(saved({ syncEnabled: true }));
      await refresh;
      assert.equal(h.dock().props['aria-busy'], false);
      assert.match(h.dock().props['aria-label'], /Syrve підключено/);
      assert.deepEqual(h.requests, ['getStatus', 'getStatus', 'getStatus']);
    }
  }
});

test('outdated status completion cannot clear the loading indicator of a newer active read', async () => {
  for (const fail of [false, true]) {
    const old = deferred(), latest = deferred();
    const h = mounted([saved(), saved(), () => old.promise, () => latest.promise]);
    await h.ready();
    await h.open();
    const finish = h.panel('SyrveAutoStatusPanel').props.onFinished;
    const first = finish('failed'), second = finish('failed');
    if (fail) old.reject(new Error('private-outdated-status'));
    else old.resolve(saved());
    await first;
    assert.equal(h.dock().props['aria-busy'], true);
    assert.match(h.html(), /Оновлюємо стан Syrve/);
    latest.resolve(saved({ displayName: 'Актуальний стан' }));
    await second;
    assert.equal(h.dock().props['aria-busy'], false);
    assert.match(h.html(), /Актуальний стан/);
    assert.doesNotMatch(h.html(), /Не вдалося оновити стан Syrve|private-outdated-status/);
  }
});

test('overlapping status reads keep only the newest result within the same settings session', async () => {
  for (const fail of [false, true]) {
    const old = deferred(), latest = deferred();
    const h = mounted([saved(), saved(), () => old.promise, () => latest.promise]);
    await h.ready();
    await h.open();
    const finish = h.panel('SyrveAutoStatusPanel').props.onFinished;
    const first = finish('failed'), second = finish('failed');
    latest.resolve(saved({ displayName: 'Актуальне підключення' }));
    await second;
    if (fail) old.reject(new Error('private-old-status'));
    else old.resolve(saved({ displayName: 'Застаріле підключення' }));
    await first;
    assert.match(h.html(), /Актуальне підключення/);
    assert.doesNotMatch(h.html(), /Застаріле підключення|Не вдалося оновити стан Syrve|private-old-status/);
  }
});

test('failure after enabling or disabling cannot invent a new auto-status state', async () => {
  for (const outcome of ['enabled', 'disabled', 'failed']) {
    const current = saved({ syncEnabled: outcome === 'disabled' });
    const h = mounted([current, current, unavailable, saved({ syncEnabled: outcome === 'enabled' })]);
    await h.ready();
    await h.open();
    await h.panel('SyrveAutoStatusPanel').props.onFinished(outcome);
    assert.match(h.html(), /Збережене підключення/);
    assert.match(h.html(), /Не вдалося оновити стан Syrve/);
    assert.equal(h.panel('SyrveAutoStatusPanel'), null);
    assert.doesNotMatch(h.html(), /Автоматичні статуси столів увімкнено\.|Автоматичні статуси вимкнено\./);
    await h.click('Спробувати ще раз');
    assert.equal(h.panel('SyrveAutoStatusPanel').props.syncEnabled, outcome === 'enabled');
  }
});

test('failure after table loading retains the connection and requests only status on retry', async () => {
  const h = mounted([saved(), saved(), unavailable, saved()]);
  await h.ready();
  await h.open();
  await h.panel('SyrveTableLoadingPanel').props.onFinished({ readCompleted: true });
  assert.match(h.html(), /Збережене підключення/);
  assert.match(h.html(), /Не вдалося оновити стан Syrve/);
  assert.doesNotMatch(h.html(), /Syrve підтвердив завантаження стану столів/);
  await h.click('Спробувати ще раз');
  assert.deepEqual(h.requests, ['getStatus', 'getStatus', 'getStatus', 'getStatus']);
});

test('failed recheck plus failed recovery preserves saved connection', async () => {
  let commands = 0;
  const h = mounted([saved(), saved(), unavailable], {
    recheck: async revision => {
      assert.equal(revision, REV);
      commands++;
      throw new Error('Сервер тимчасово недоступний');
    },
  });
  await h.ready();
  await h.open();
  await h.click('Перевірити');
  assert.equal(commands, 1);
  assert.match(h.html(), /Збережене підключення/);
  assert.match(h.html(), /Не вдалося оновити стан Syrve/);
  assert.equal(h.button('Змінити дані').props.disabled, true);
});

test('explicit confirmed disconnect still updates the saved server state', async () => {
  let commands = 0;
  const h = mounted([saved(), saved()], {
    disconnect: async revision => {
      assert.equal(revision, REV);
      commands++;
      return { integration: saved({ hasCredentials: false, status: 'not_connected', syncEnabled: false }) };
    },
  });
  await h.ready();
  await h.open();
  await h.click('Відключити');
  assert.equal(commands, 1);
  assert.equal(h.dock().props['aria-label'], 'Підключити Syrve');
  assert.doesNotMatch(h.html(), /Поточне підключення|Не вдалося оновити стан Syrve/);
});

test('newly saved connection retains its summary after a failed refresh and shows the recovered consent', async () => {
  const disconnected = saved({ hasCredentials: false, status: 'not_connected' });
  let connections = 0;
  const h = mounted([disconnected, disconnected, unavailable, saved({ syncEnabled: true })], {
    test: async () => ({ apiBaseUrl: 'https://api-eu.syrve.live', organizations: [{ id: ORG, name: 'Ресторан MOLO' }] }),
    previewTables: async () => ({ organization: { id: ORG }, proposals: [], confirmation: { proof: 'confirmed-proof' } }),
    connect: async payload => {
      assert.equal(payload.organizationId, ORG);
      assert.equal(payload.confirmationProof, 'confirmed-proof');
      connections++;
      return { integration: saved() };
    },
  });
  await h.ready();
  await h.open();
  find(h.render(), node => node.type === 'input' && node.props.autoComplete === 'off')
    .props.onChange({ target: { value: 'test-api-key' } });
  await h.click('Перевірити підключення');
  await h.click('Перевірити столи');
  await h.click('Зберегти підключення');
  assert.equal(connections, 1);
  assert.match(h.html(), /Підключення збережено/);
  await h.panel('SyrveAutoStatusPanel').props.onFinished('enabled');
  assert.match(h.html(), /Збережене підключення/);
  assert.match(h.html(), /Не вдалося оновити стан Syrve/);
  assert.doesNotMatch(h.html(), /Синхронізація ще не ввімкнена|test-api-key/);
  await h.click('Спробувати ще раз');
  assert.equal(h.panel('SyrveAutoStatusPanel').props.syncEnabled, true);
  assert.doesNotMatch(h.html(), /Синхронізація ще не ввімкнена|Не вдалося оновити стан Syrve/);
  assert.equal(connections, 1);
});

test('disconnected Syrve with saved links offers the reset action before entering the wizard', async () => {
  const disconnected = saved({ hasCredentials: false, status: 'not_connected',
    organizationId: null, organizationName: null, apiLoginMasked: null, confirmedLinks: 2 });
  const h = mounted([disconnected, disconnected]);
  await h.ready();
  await h.open();
  const reset = h.button('Скинути прив’язки Syrve та підключити заново');
  assert.ok(reset, 'Director can reach reset after disconnect with saved links');
  assert.equal(reset.props.disabled, false);
  assert.doesNotMatch(h.html(), /API-логін \/ ключ/);
  assert.ok(h.button('Підключити Syrve без скидання прив’язок'));
  await h.click('Підключити Syrve без скидання прив’язок');
  assert.match(h.html(), /API-логін \/ ключ/);
  assert.deepEqual(h.requests, ['getStatus', 'getStatus']);
});

test('disconnected Syrve without saved links still opens the connection wizard automatically', async () => {
  const disconnected = saved({ hasCredentials: false, status: 'not_connected',
    organizationId: null, organizationName: null, apiLoginMasked: null, confirmedLinks: 0 });
  const h = mounted([disconnected, disconnected]);
  await h.ready();
  await h.open();
  assert.match(h.html(), /API-логін \/ ключ/);
  assert.equal(h.button('Скинути прив’язки Syrve та підключити заново'), null);
});
