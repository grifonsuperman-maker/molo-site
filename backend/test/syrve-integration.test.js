const assert = require('node:assert/strict');
const test = require('node:test');
const { settingsHarness } = require('./helpers/syrve-settings-harness.js');
const { SyrveClient } = require('../dist/syrve/syrve-client.js');
const { SyrveIntegrationService } = require('../dist/syrve/syrve-integration.service.js');

const ORG = 'a1111111-2222-3333-4444-555555555555';
const LOGIN = 'restaurant-api-secret';
const INPUT = { displayName: 'MOLO', apiBaseUrl: 'https://api-eu.syrve.live', apiLogin: LOGIN,
  organizationId: ORG, organizationName: 'Untrusted browser name' };

function setup(t) {
  const keys = ['SYRVE_APP_ID', 'SYRVE_APP_CLIENT_SECRET', 'SYRVE_CREDENTIALS_SECRET',
    'NODE_ENV', 'RENDER_EXTERNAL_URL', 'JWT_SECRET'];
  const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  t.after(() => {
    for (const key of keys) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  });
  process.env.NODE_ENV = 'production';
  process.env.RENDER_EXTERNAL_URL = '';
  process.env.SYRVE_CREDENTIALS_SECRET = 'separate-long-syrve-storage-secret';
  process.env.JWT_SECRET = 'separate-long-jwt-secret';
  process.env.SYRVE_APP_ID = '';
  process.env.SYRVE_APP_CLIENT_SECRET = '';
  const h = settingsHarness();
  const logs = [];
  const service = new SyrveIntegrationService(h.store, { create: async (...args) => logs.push(args) },
    new SyrveClient(), { find: async () => [] });
  const nativeConnect = service.connect.bind(service);
  service.connect = async (input, actor) => {
    const preview = await service.previewTables(input);
    return nativeConnect({ ...input, pairs: [], confirmationProof: preview.confirmation.proof }, actor);
  };
  const nativeRecheck = service.recheck.bind(service);
  service.recheck = () => nativeRecheck({ configurationRevision: h.entity()?.configurationRevision });
  const nativeDisconnect = service.disconnect.bind(service);
  service.disconnect = (reason) => nativeDisconnect({ configurationRevision: h.entity()?.configurationRevision, reason });
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('access_token')) return Response.json({ token: 'backend-token' });
    if (url.endsWith('terminal_groups')) return Response.json({ terminalGroups: [], terminalGroupsInSleep: [] });
    return Response.json({ organizations: [{ id: ORG, name: 'Verified restaurant' }] });
  });
  return { service, writes: h.writes, logs, calls, row: h.entity };
}

test('connection test reads upstream without creating a local integration or writing logs', async (t) => {
  const h = setup(t);
  const result = await h.service.test(INPUT);
  assert.equal(result.diagnostics.syncEnabled, false);
  assert.equal(result.diagnostics.tables.status, 'not_checked');
  assert.equal(result.diagnostics.orders.status, 'not_checked');
  assert.deepEqual(h.writes, []);
  assert.deepEqual(h.logs, []);
  assert.equal(h.calls.length, 2);
});

test('connect preserves AES-GCM storage and recheck decrypts only on the backend', async (t) => {
  const h = setup(t);
  const result = await h.service.connect(INPUT, { role: 'owner', name: 'Директор' });
  const saved = h.row();
  assert.ok(saved.apiLoginEncrypted);
  assert.notEqual(saved.apiLoginEncrypted, LOGIN);
  assert.equal(Buffer.from(saved.apiLoginIv, 'base64').length, 12);
  assert.equal(Buffer.from(saved.apiLoginAuthTag, 'base64').length, 16);
  assert.equal(saved.organizationName, 'Verified restaurant');
  assert.equal(result.integration.syncEnabled, false);
  for (const response of [result, await h.service.getStatus(), await h.service.recheck()]) {
    const json = JSON.stringify(response);
    for (const forbidden of [LOGIN, 'backend-token', saved.apiLoginEncrypted, saved.apiLoginIv, saved.apiLoginAuthTag]) {
      assert.ok(!json.includes(forbidden));
    }
  }
  assert.ok(h.calls.some((call) => call.url.endsWith('access_token') && JSON.parse(call.options.body).apiLogin === LOGIN));
  assert.ok(!JSON.stringify(h.logs).includes(LOGIN));
  process.env.JWT_SECRET = 'rotated-jwt-secret';
  assert.equal((await h.service.recheck()).integration.status, 'connected');
});

test('production storage secret is required only for Syrve operations, not MOLO status/startup', async (t) => {
  const h = setup(t);
  process.env.SYRVE_CREDENTIALS_SECRET = '';
  assert.equal((await h.service.getStatus()).syncEnabled, false);
  await assert.rejects(h.service.test(INPUT), /SYRVE_CREDENTIALS_SECRET/);
  await assert.rejects(h.service.connect(INPUT), /SYRVE_CREDENTIALS_SECRET/);
  assert.equal(h.calls.length, 0);
});

test('Render is treated as production even when NODE_ENV is absent', async (t) => {
  const h = setup(t);
  process.env.NODE_ENV = '';
  process.env.RENDER_EXTERNAL_URL = 'https://molo.example';
  process.env.SYRVE_CREDENTIALS_SECRET = '';
  await assert.rejects(h.service.test(INPUT), /SYRVE_CREDENTIALS_SECRET/);
  assert.equal(h.calls.length, 0);
});

test('development keeps the existing JWT-derived encryption compatibility', async (t) => {
  const h = setup(t);
  process.env.NODE_ENV = 'development';
  process.env.SYRVE_CREDENTIALS_SECRET = '';
  await h.service.connect(INPUT);
  assert.equal((await h.service.recheck()).integration.status, 'connected');
});

test('organization UUID casing remains compatible with previously stored connections', async (t) => {
  const h = setup(t);
  await h.service.connect({ ...INPUT, organizationId: ORG.toUpperCase() });
  h.row().organizationId = ORG.toUpperCase();
  assert.equal((await h.service.recheck()).integration.status, 'connected');
});

test('authentication failure leaves an existing configuration intact', async (t) => {
  const h = setup(t);
  await h.service.connect(INPUT);
  const before = { ...h.row() };
  const writeCount = h.writes.length;
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: LOGIN }, { status: 401 }));
  await assert.rejects(h.service.connect({ ...INPUT, apiLogin: 'different-secret' }));
  assert.deepEqual(h.row(), before);
  assert.equal(h.writes.length, writeCount);
});

test('offline recheck preserves credentials and records only a safe integration error', async (t) => {
  const h = setup(t);
  await h.service.connect(INPUT);
  const before = { ...h.row() };
  t.mock.method(globalThis, 'fetch', async () => { throw new Error(`${LOGIN} backend-token`); });
  await assert.rejects(h.service.recheck(), (error) => error.getResponse().code === 'SYRVE_UNAVAILABLE');
  const status = await h.service.getStatus();
  assert.equal(status.status, 'error');
  assert.equal(status.syncEnabled, false);
  assert.equal(h.row().apiLoginEncrypted, before.apiLoginEncrypted);
  assert.equal(h.row().organizationId, before.organizationId);
  assert.equal(h.row().connectedAt, before.connectedAt);
  assert.ok(!JSON.stringify(h.writes).includes(LOGIN));
  assert.ok(!JSON.stringify(status).includes('backend-token'));
});

test('tampered ciphertext fails safely without contacting Syrve', async (t) => {
  const h = setup(t);
  await h.service.connect(INPUT);
  h.row().apiLoginAuthTag = Buffer.alloc(16).toString('base64');
  const count = h.calls.length;
  await assert.rejects(h.service.recheck(), /Не вдалося розшифрувати/);
  assert.equal(h.calls.length, count);
});

test('disconnect removes encrypted credentials and keeps synchronization disabled', async (t) => {
  const h = setup(t);
  await h.service.connect(INPUT);
  const result = await h.service.disconnect('Перевірка');
  assert.equal(result.integration.syncEnabled, false);
  assert.equal(result.integration.hasCredentials, false);
  for (const key of ['apiLoginEncrypted', 'apiLoginIv', 'apiLoginAuthTag', 'apiLoginMasked']) {
    assert.equal(h.row()[key], null);
  }
});
