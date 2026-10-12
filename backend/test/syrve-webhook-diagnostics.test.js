const assert = require('node:assert/strict');
const test = require('node:test');
const { SyrveClient } = require('../dist/syrve/syrve-client.js');
const { SyrveIntegrationService } = require('../dist/syrve/syrve-integration.service.js');
const { summarizeSyrveWebhookSettings } = require('../dist/syrve/syrve-webhook-diagnostics.js');
const ORG = 'a0000000-0000-4000-8000-000000000001';
const REV = 'b0000000-0000-4000-8000-000000000001';
const OTHER = 'c0000000-0000-4000-8000-000000000001';
const BASE = 'https://api-eu.syrve.live', LOGIN = 'fixture-api-secret';
const payload = () => ({ correlationId: REV, apiLoginName: 'private-login',
  webHooksUri: 'https://private-user:private-pass@example.test/hook/private-path?token=private-query',
  authToken: 'private-webhook-token', webHooksFilter: { privateNested: 'private-value' } });
function transport(t, responses) {
  const keys = ['SYRVE_APP_ID', 'SYRVE_APP_CLIENT_SECRET'];
  const previous = keys.map(key => process.env[key]); keys.forEach(key => process.env[key] = '');
  t.after(() => keys.forEach((key, i) => previous[i] === undefined ? delete process.env[key] : process.env[key] = previous[i]));
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ path: new URL(url).pathname, body: JSON.parse(options.body) });
    const response = responses.shift(); assert.ok(response, 'unexpected provider request');
    return typeof response === 'function' ? response() : response;
  });
  return { client: new SyrveClient(require('./helpers/syrve-test-request-limiter.js')), calls };
}
const auth = () => [Response.json({ token: 'fixture-token' }), Response.json({ organizations: [{ id: ORG, name: 'MOLO' }] })];

test('webhook read returns only booleans; URLs, login names and tokens never enter the result', async t => {
  const h = transport(t, [...auth(), Response.json(payload()), Response.json({ ...payload(), webHooksUri: null, authToken: null })]);
  const result = await h.client.webhookDiagnostics(BASE, LOGIN, ORG.toUpperCase(), async () => {});
  assert.deepEqual(h.calls.map(call => call.path), ['/api/1/access_token', '/api/1/organizations', '/api/1/webhooks/settings']);
  assert.deepEqual(h.calls[2].body, { organizationId: ORG });
  assert.equal(result.settingsReadAccess, 'confirmed'); assert.equal(result.settingsWriteAccess, 'not_checked');
  assert.equal(result.webhookAddressSet, true); assert.equal(result.authorizationSet, true);
  assert.equal(result.settingsChanged, false); assert.equal(result.statusesApplied, false);
  assert.doesNotMatch(JSON.stringify(result), /private-|fixture-|example\.test/);
  const absent = await h.client.webhookDiagnostics(BASE, LOGIN, ORG, async () => {});
  assert.equal(absent.webhookAddressSet, false); assert.equal(absent.authorizationSet, false);
  assert.equal(h.calls.length, 4, 'reuse the bounded auth session, but read settings afresh');
});

test('a provider failure is not retried and never tests permission by changing settings', async t => {
  for (const [status, code] of [[401, 'SYRVE_AUTH_FAILED'], [403, 'SYRVE_ACCESS_DENIED'], [429, 'SYRVE_RATE_LIMITED'], [500, 'SYRVE_UNAVAILABLE']]) {
    const h = transport(t, [...auth(), Response.json({ privateError: 'private-provider-secret' }, { status })]);
    await assert.rejects(h.client.webhookDiagnostics(BASE, LOGIN, ORG, async () => {}), error => {
      assert.equal(error.getResponse().code, code);
      assert.doesNotMatch(JSON.stringify(error.getResponse()), /private-|fixture-/); return true;
    });
    assert.equal(h.calls.length, 3); assert.equal(h.calls.at(-1).path, '/api/1/webhooks/settings');
  }
});

test('missing and malformed settings never become a successful permission report', () => {
  for (const change of [p => delete p.correlationId, p => p.correlationId = 'bad', p => delete p.webHooksUri,
    p => p.webHooksUri = {}, p => p.authToken = true, p => delete p.apiLoginName]) {
    const p = payload(); change(p); assert.throws(() => summarizeSyrveWebhookSettings(p));
  }
  assert.throws(() => summarizeSyrveWebhookSettings([]));
  const empty = summarizeSyrveWebhookSettings({ ...payload(), webHooksUri: ' ', authToken: undefined, apiLoginName: null });
  assert.equal(empty.webhookAddressSet, false); assert.equal(empty.authorizationSet, false);
});

test('revoked configuration fences both the outbound read and the returned report', async t => {
  const before = transport(t, []);
  await assert.rejects(before.client.webhookDiagnostics(BASE, LOGIN, ORG, async () => { throw new Error('revoked'); }), /revoked/);
  assert.equal(before.calls.length, 0);
  let revoked = false;
  const after = transport(t, [...auth(), () => { revoked = true; return Response.json(payload()); }]);
  await assert.rejects(after.client.webhookDiagnostics(BASE, LOGIN, ORG,
    async () => { if (revoked) throw new Error('revoked'); }), /revoked/);
  assert.equal(after.calls.length, 3);
});

function serviceHarness(t, mutate) {
  const saved = { prepared: true, links: [], entity: { id: ORG, configurationRevision: REV, status: 'connected',
    organizationId: ORG, apiBaseUrl: BASE, apiLoginEncrypted: 'encrypted', apiLoginIv: 'iv', apiLoginAuthTag: 'tag' } };
  const store = { read: async () => structuredClone(saved) };
  const noWrite = () => assert.fail('diagnostics must not write business state');
  const service = new SyrveIntegrationService(store, { create: noWrite }, {
    webhookDiagnostics: async (base, login, org, guard) => {
      assert.equal(base, BASE); assert.equal(login, LOGIN); assert.equal(org, ORG);
      await guard(); mutate?.(saved); await guard();
      return { startedAt: '2026-10-12T09:00:00Z', checkedAt: '2026-10-12T09:00:01Z', ...summarizeSyrveWebhookSettings(payload()) };
    },
  }, { find: noWrite, save: noWrite });
  t.mock.method(service, 'decrypt', () => LOGIN);
  return { service, saved };
}
test('saved credentials are used without loading tables or altering connection, logs or statuses', async t => {
  const h = serviceHarness(t), before = structuredClone(h.saved);
  const result = await h.service.webhookDiagnostics({ configurationRevision: REV });
  assert.equal(result.organizationId, ORG); assert.equal(result.configurationRevision, REV);
  assert.equal(result.settingsReadAccess, 'confirmed'); assert.deepEqual(h.saved, before);
  assert.doesNotMatch(JSON.stringify(result), /private-|encrypted|fixture-/);
});
test('rotated credentials and changed organization or revision reject a delayed result', async t => {
  for (const mutate of [s => s.entity.configurationRevision = OTHER, s => s.entity.organizationId = OTHER,
    s => s.entity.apiLoginEncrypted = 'rotated', s => s.entity.status = 'not_connected', s => s.prepared = false]) {
    const h = serviceHarness(t, mutate);
    await assert.rejects(h.service.webhookDiagnostics({ configurationRevision: REV }), error => error.getStatus() === 409);
  }
});
