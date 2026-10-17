const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

async function flush() { for (let i = 0; i < 30; i++) await Promise.resolve(); }
function deferred() {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
}
function nodes(tree, predicate) {
  if (!tree || typeof tree !== 'object') return [];
  return [...(predicate(tree) ? [tree] : []),
    ...[tree.props?.children].flat(Infinity).flatMap(child => nodes(child, predicate))];
}
function text(tree) {
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  return tree && typeof tree === 'object' ? [tree.props?.children].flat(Infinity).map(text).join('') : '';
}

// Run the production TSX and API adapter with deterministic hooks/network/time.
// Storage is intentionally unavailable, and stale replies may ignore abort.
function mounted() {
  const requests = [], values = [], refs = [], effects = [], queued = [];
  const timers = new Map(), listeners = new Map(), modules = new Map();
  let stateIndex, refIndex, effectIndex, timerId = 0, tree, clock = Date.now();
  let reply = async () => ({ status: 200, data: session(true) });
  class Clock extends Date { static now() { return clock; } }
  function session(withToken = false) {
    return { user: { role: 'developer', name: 'Розробник' },
      sessionExpiresAt: new Date(clock + 900000).toISOString(), version: 'a123456',
      ...(withToken ? { accessToken: 'test-only-developer-token' } : {}) };
  }
  const hooks = {
    useState(initial) {
      const index = stateIndex++;
      if (!(index in values)) values[index] = typeof initial === 'function' ? initial() : initial;
      return [values[index], value => { values[index] = typeof value === 'function' ? value(values[index]) : value; }];
    },
    useRef(initial) { const index = refIndex++; return refs[index] ??= { current: initial }; },
    useEffect(work, deps) {
      const index = effectIndex++, prior = effects[index];
      if (!prior || deps.some((value, i) => !Object.is(value, prior.deps[i]))) {
        effects[index] = { deps, cleanup: prior?.cleanup };
        queued.push(() => { effects[index].cleanup?.(); effects[index].cleanup = work(); });
      }
    },
  };
  const surface = name => ({
    addEventListener(event, callback) { listeners.set(`${name}:${event}`, callback); },
    removeEventListener(event, callback) { if (listeners.get(`${name}:${event}`) === callback) listeners.delete(`${name}:${event}`); },
  });
  const window = { ...surface('window'),
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    setInterval() { assert.fail('the console must not add polling'); },
    get localStorage() { assert.fail('developer access must not use staff/persistent storage'); },
    get sessionStorage() { assert.fail('developer access must not use staff/persistent storage'); },
  };
  const document = surface('document');
  function load(file) {
    if (modules.has(file)) return modules.get(file);
    const exports = {}; modules.set(file, exports);
    const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX,
    } }).outputText;
    vm.runInNewContext(output, { exports, window, document, Date: Clock, Intl, AbortController, Error,
      async fetch(url, options) {
        requests.push({ url, options }); const result = await reply(url, options);
        return { ok: result.status >= 200 && result.status < 300, status: result.status,
          json: async () => result.data };
      },
      require(id) {
        if (id === 'react') return hooks;
        if (id === '../api/client') return { API_URL: 'https://test.invalid/api',
          getAccessToken() { assert.fail('staff credentials must not be read'); },
          setAccessToken() { assert.fail('staff credentials must not be overwritten'); } };
        if (id.startsWith('.')) {
          const target = path.resolve(path.dirname(file), id);
          return load(fs.existsSync(`${target}.ts`) ? `${target}.ts` : `${target}.tsx`);
        }
        return require(id);
      },
    }, { filename: file });
    return exports;
  }
  const component = load(path.resolve(__dirname, '../src/developer/DeveloperWorkspace.tsx')).default;
  function render() {
    stateIndex = refIndex = effectIndex = 0; tree = component();
    while (queued.length) queued.shift()();
    return tree;
  }
  const h = {
    requests, timers, render, session,
    get output() { return text(render()); },
    setReply(fn) { reply = fn; },
    change(id, value) {
      const input = nodes(render(), node => node.type === 'input' && node.props.id === id)[0];
      assert.ok(input); input.props.onChange({ target: { value } }); render();
    },
    submit() { nodes(render(), node => node.type === 'form')[0].props.onSubmit({ preventDefault() {} }); render(); },
    async login() {
      h.change('developer-login', 'test-developer');
      h.change('developer-password', 'test-only-developer-password');
      h.submit(); await flush(); render();
    },
    click(label) {
      const button = nodes(render(), node => node.type === 'button' && text(node) === label)[0];
      assert.ok(button, `button ${label} must be available`); button.props.onClick(); render();
    },
    advance(ms) { clock += ms; },
    focus() { listeners.get('window:focus')?.(); render(); },
    unmount() { effects.forEach(effect => effect.cleanup?.()); },
  };
  render(); return h;
}

test('console loads without requests and authenticates separately when browser storage is blocked', async () => {
  const h = mounted();
  assert.equal(h.requests.length, 0);
  assert.match(h.output, /Окремий вхід/);
  await h.login();
  assert.equal(h.requests.length, 1);
  const { url, options } = h.requests[0];
  assert.equal(url, 'https://test.invalid/api/developer/login');
  assert.equal(options.cache, 'no-store'); assert.equal(options.credentials, 'omit');
  assert.equal(options.headers.Authorization, undefined);
  assert.equal(JSON.parse(options.body).login, 'test-developer');
  assert.match(h.output, /Доступ підтверджено/);
  assert.match(h.output, /a123456/);
  assert.doesNotMatch(h.output, /test-only-developer-token|test-only-developer-password/);
  assert.equal(h.timers.size, 1, 'only the session expiry timer remains');
  h.unmount(); assert.equal(h.timers.size, 0);
});

test('manual session check uses only the developer token and triggers no Syrve polling', async () => {
  const h = mounted(); await h.login();
  h.setReply(async () => ({ status: 200, data: h.session() }));
  h.click('Перевірити доступ'); await flush(); h.render();
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[1].url, 'https://test.invalid/api/developer/session');
  assert.equal(h.requests[1].options.headers.Authorization, 'Bearer test-only-developer-token');
  assert.equal(h.requests[1].options.credentials, 'omit');
  assert.equal(h.timers.size, 1);
  h.unmount();
});

test('server revocation removes the workspace without exposing server error details', async () => {
  const h = mounted(); await h.login();
  h.setReply(async () => ({ status: 401, data: { message: 'private-password-hash-or-SQL' } }));
  h.click('Перевірити доступ'); await flush(); h.render();
  assert.match(h.output, /Окремий вхід/);
  assert.match(h.output, /сеанс завершено/);
  assert.doesNotMatch(h.output, /private-password-hash-or-SQL|Доступ підтверджено/);
  assert.equal(h.timers.size, 0);
  h.unmount();
});

test('logout cancels a pending check and a late successful response cannot restore access', async () => {
  const h = mounted(); await h.login(); const pending = deferred();
  h.setReply(() => pending.promise);
  h.click('Перевірити доступ');
  const signal = h.requests[1].options.signal;
  h.click('Вийти'); assert.equal(signal.aborted, true);
  pending.resolve({ status: 200, data: h.session() }); await flush(); h.render();
  assert.match(h.output, /Окремий вхід/);
  assert.doesNotMatch(h.output, /Доступ підтверджено/);
  assert.equal(h.timers.size, 0);
  h.unmount();
});

test('resuming a tab after expiration clears the session without a network request', async () => {
  const h = mounted(); await h.login();
  h.advance(900001); h.focus();
  assert.match(h.output, /Сеанс завершено/);
  assert.match(h.output, /Окремий вхід/);
  assert.equal(h.requests.length, 1);
  assert.equal(h.timers.size, 0);
  h.unmount();
});

test('malformed or expired login responses never open the developer workspace', async () => {
  for (const changed of [
    { user: { role: 'owner' } }, { accessToken: '' }, { sessionExpiresAt: 'invalid' },
    { sessionExpiresAt: '2000-01-01T00:00:00Z' }, { version: 'private-config' },
  ]) {
    const h = mounted(); h.setReply(async () => ({ status: 200, data: { ...h.session(true), ...changed } }));
    await h.login();
    assert.match(h.output, /Окремий вхід/); assert.doesNotMatch(h.output, /Доступ підтверджено/);
    h.unmount();
  }
});

test('network and configuration failures show understandable errors without internal details', async () => {
  for (const reply of [
    async () => { throw new Error('Failed to fetch private-server-name'); },
    async () => ({ status: 503, data: { message: 'private-environment-or-config' } }),
    async () => ({ status: 429, data: { message: 'private-environment-or-config' } }),
  ]) {
    const h = mounted(); h.setReply(reply); await h.login();
    assert.match(h.output, /Окремий вхід/);
    assert.doesNotMatch(h.output, /private-|Failed to fetch|Доступ підтверджено/);
    h.unmount();
  }
});

test('timeout releases the login form and ignores a late authentication response', async () => {
  const h = mounted(); const pending = deferred(); h.setReply(() => pending.promise);
  h.change('developer-login', 'test-developer'); h.change('developer-password', 'test-only-password'); h.submit();
  const timeout = [...h.timers.values()].find(item => item.delay === 15000);
  assert.ok(timeout); timeout.callback();
  pending.resolve({ status: 200, data: h.session(true) }); await flush(); h.render();
  assert.match(h.output, /Окремий вхід/);
  assert.doesNotMatch(h.output, /Доступ підтверджено/);
  assert.equal(nodes(h.render(), node => node.type === 'button' && node.props.type === 'submit')[0].props.disabled, false);
  h.unmount();
});

test('actual entrypoint keeps guest/staff components and the role-switch path separate from the developer route', () => {
  const routeFile = path.resolve(__dirname, '../src/developer/developerConsoleRoute.ts');
  const routeExports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(routeFile, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, { exports: routeExports });
  const boundaryExports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '../src/developer/DeveloperConsoleBoundary.tsx'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports: boundaryExports, require });
  const Boundary = boundaryExports.default;
  const App = () => null, Install = () => null, Push = () => null, Developer = () => null;
  for (const [pathname, developerRoute] of [['/developer', true], ['/developer/', true], ['/', false], ['/__dev/roles', false]]) {
    let rendered;
    const entryExports = {};
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '../src/entryRoute.ts'), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText, { exports: entryExports, window: { location: { pathname } },
      require(id) { assert.equal(id, './developer/developerConsoleRoute'); return routeExports; },
    });
    const output = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '../src/main.tsx'), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText;
    const stubs = {
      react: { ...require('react'), lazy: () => Developer },
      'react-dom/client': { createRoot: () => ({ render(tree) { rendered = tree; } }) },
      './App': { default: App }, './guest/components/GuestInstallPrompt': { default: Install },
      './guest/components/GuestPushOptIn': { default: Push },
      './entryRoute': entryExports,
      './developer/DeveloperConsoleBoundary': { __esModule: true, default: Boundary },
    };
    // Default-import stubs need the same ES module shape as production TS.
    for (const id of ['./App', './guest/components/GuestInstallPrompt', './guest/components/GuestPushOptIn']) stubs[id].__esModule = true;
    vm.runInNewContext(output, { exports: {}, window: { location: { pathname } },
      document: { getElementById: () => ({}) },
      require(id) { return id.endsWith('.css') ? {} : stubs[id] || require(id); },
    });
    assert.equal(nodes(rendered, node => node.type === Developer).length, developerRoute ? 1 : 0);
    const boundaries = nodes(rendered, node => node.type === Boundary);
    assert.equal(boundaries.length, developerRoute ? 1 : 0);
    if (developerRoute) {
      assert.equal(nodes(boundaries[0], node => node.type === require('react').Suspense).length, 1);
      assert.equal(nodes(boundaries[0], node => node.type === Developer).length, 1);
    }
    for (const component of [App, Install, Push]) assert.equal(nodes(rendered, node => node.type === component).length, developerRoute ? 0 : 1);
  }
});
