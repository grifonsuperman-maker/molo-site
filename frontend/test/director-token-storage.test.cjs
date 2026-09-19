const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.resolve(__dirname, '../src/api/client.ts'), 'utf8')
  .replace('import.meta.env.VITE_API_URL', 'undefined');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

function storage({ failRead = false, failWrite = false } = {}) {
  const entries = new Map();
  return {
    entries,
    getItem(key) {
      if (failRead) throw new Error('storage read blocked');
      return entries.get(key) || null;
    },
    setItem(key, value) {
      if (failWrite) throw new Error('storage write blocked');
      entries.set(key, value);
    },
    removeItem(key) {
      if (failWrite) throw new Error('storage write blocked');
      entries.delete(key);
    },
  };
}

function client(localStorage, sessionStorage, fetch = async () => ({
  ok: true,
  json: async () => ({}),
})) {
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, localStorage, sessionStorage, fetch, URLSearchParams,
  }, { filename: 'client.js' });
  return exports;
}

test('normal token storage and clearing work unchanged', () => {
  const local = storage();
  const session = storage();
  const api = client(local, session);
  api.setAccessToken('new-token');
  assert.equal(local.getItem('molo_access_token'), 'new-token');
  assert.equal(api.getAccessToken(), 'new-token');
  api.clearAccessToken();
  assert.equal(api.getAccessToken(), null);
});

test('blocked localStorage uses sessionStorage across a reload', () => {
  const local = storage({ failWrite: true });
  const session = storage();
  const api = client(local, session);
  assert.doesNotThrow(() => api.setAccessToken('rotated-director-token'));
  assert.equal(api.getAccessToken(), 'rotated-director-token');
  assert.equal(session.getItem('molo_access_token'), 'rotated-director-token');
  assert.equal(client(local, session).getAccessToken(), 'rotated-director-token');
  assert.doesNotThrow(() => api.clearAccessToken());
  assert.equal(session.getItem('molo_access_token'), null);
});

test('both storages blocked do not falsely report a failed password change', async () => {
  const local = storage({ failRead: true, failWrite: true });
  const session = storage({ failRead: true, failWrite: true });
  let authorization;
  const api = client(local, session, async (_url, options) => {
    authorization = options.headers.Authorization;
    return { ok: true, json: async () => ({ ok: true }) };
  });
  assert.doesNotThrow(() => api.setAccessToken('fresh-token'));
  assert.equal(api.getAccessToken(), 'fresh-token');
  await api.api.get('/staff/director-access');
  assert.equal(authorization, 'Bearer fresh-token');
  assert.doesNotThrow(() => api.clearAccessToken());
  assert.equal(api.getAccessToken(), null);
});

test('session fallback is preferred to a stale persistent token', () => {
  const local = storage({ failWrite: true });
  local.entries.set('molo_access_token', 'revoked-token');
  const session = storage();
  const api = client(local, session);
  api.setAccessToken('fresh-token');
  assert.equal(client(local, session).getAccessToken(), 'fresh-token');
});
