const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

async function flush() { for (let i = 0; i < 24; i++) await Promise.resolve(); }

// Execute the real entry loader and shared route module. SDK readiness is
// controlled separately from the main module import, just as in the browser.
function boot(pathname, failApplication = false) {
  const source = path.resolve(__dirname, '../src');
  const scripts = [], starts = [], modules = new Map();
  const root = { textContent: '' };
  const window = { location: { pathname, hash: '' } };
  const document = {
    createElement(tag) { assert.equal(tag, 'script'); return {}; },
    head: { appendChild(script) { scripts.push(script); } },
    getElementById(id) { assert.equal(id, 'root'); return root; },
  };
  function load(file) {
    if (modules.has(file)) return modules.get(file);
    if (file === path.join(source, 'main.tsx')) {
      if (failApplication) throw new Error('test-only chunk loading failure');
      const entry = load(path.join(source, 'entryRoute.ts'));
      const runtime = load(path.join(source, 'telegram/telegramRuntime.ts'));
      starts.push({ developer: entry.isDeveloperConsoleEntry,
        initData: runtime.getTelegramWebApp()?.initData });
      const exports = {}; modules.set(file, exports); return exports;
    }
    const exports = {}; modules.set(file, exports);
    const javascript = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
    } }).outputText;
    vm.runInNewContext(javascript, { exports, window, document, require(id) {
      const target = path.resolve(path.dirname(file), id);
      return load(fs.existsSync(`${target}.ts`) ? `${target}.ts` : `${target}.tsx`);
    } }, { filename: file });
    return exports;
  }
  load(path.join(source, 'bootstrap.ts'));
  return { scripts, starts, root, window,
    ready(initData = '') { window.Telegram = { WebApp: { initData } }; scripts[0].onload(); },
    role(role) { return load(path.join(source, 'telegram/telegramRuntime.ts')).telegramRoleToMode(role); },
  };
}

test('SPA document loads only the local route-aware entry and has no unconditional external script', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script\b[^>]*>[\s\S]*?<\/script>/g)].map(match => match[0]);
  assert.equal(scripts.length, 1);
  assert.match(scripts[0], /type="module"/);
  assert.match(scripts[0], /src="\/src\/bootstrap\.ts"/);
  assert.doesNotMatch(html, /<script[^>]*src=["'](?:https?:)?\/\//);
  assert.doesNotMatch(html, /telegram-web-app\.js/);
});

test('both developer entry URLs start without inserting or waiting for Telegram SDK', async () => {
  for (const pathname of ['/developer', '/developer/']) {
    const h = boot(pathname); await flush();
    assert.equal(h.scripts.length, 0);
    assert.deepEqual(h.starts, [{ developer: true, initData: undefined }]);
  }
});

test('ordinary site and protected role-switch entry retain the original SDK URL and wait before importing the app', async () => {
  for (const pathname of ['/', '/__dev/roles', '/other']) {
    const h = boot(pathname); await flush();
    assert.equal(h.scripts.length, 1);
    assert.equal(h.scripts[0].src, 'https://telegram.org/js/telegram-web-app.js?59');
    assert.equal(h.starts.length, 0, 'application must not initialize Telegram auth before SDK readiness');
    h.ready('test-only-signed-init-data'); await flush();
    assert.deepEqual(h.starts, [{ developer: false, initData: 'test-only-signed-init-data' }]);
  }
});

test('guest and all existing staff Telegram roles see initData when their application starts', async () => {
  for (const [role, mode] of [['guest', 'guest'], ['waiter', 'waiter'], ['hookah', 'hookah'], ['admin', 'admin'], ['owner', 'director']]) {
    const h = boot('/'); h.window.location.hash = `#${mode}`;
    await flush(); assert.equal(h.starts.length, 0);
    h.ready(`test-only-${role}-init-data`); await flush();
    assert.equal(h.starts[0].initData, `test-only-${role}-init-data`);
    assert.equal(h.role(role), mode);
    assert.equal(h.window.location.hash, `#${mode}`);
  }
});

test('SDK load error preserves the existing browser fallback instead of preventing startup', async () => {
  const h = boot('/'); h.scripts[0].onerror(); await flush();
  assert.deepEqual(h.starts, [{ developer: false, initData: undefined }]);
  assert.equal(h.root.textContent, '');
});

test('a URL change while the external SDK loads cannot switch the document to the credential console', async () => {
  const h = boot('/'); h.window.location.pathname = '/developer';
  h.ready('test-only-init-data'); await flush();
  assert.equal(h.starts.length, 1);
  assert.equal(h.starts[0].developer, false);
});

test('duplicate SDK readiness events do not import or start the application twice', async () => {
  const h = boot('/'); h.ready('test-only-init-data'); h.scripts[0].onload(); await flush();
  assert.equal(h.scripts.length, 1); assert.equal(h.starts.length, 1);
});

test('an application import failure shows a Ukrainian recovery message without mounting credentials', async () => {
  const h = boot('/developer', true); await flush();
  assert.equal(h.scripts.length, 0); assert.equal(h.starts.length, 0);
  assert.equal(h.root.textContent, 'Не вдалося завантажити застосунок. Оновіть сторінку.');
});
