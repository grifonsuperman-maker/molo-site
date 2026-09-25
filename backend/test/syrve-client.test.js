const assert = require('node:assert/strict');
const test = require('node:test');
const { SyrveClient } = require('../dist/syrve/syrve-client.js');

const BASE = 'https://api-eu.syrve.live';
const ORG = '11111111-2222-3333-4444-555555555555';
const LOGIN = 'restaurant-api-secret';
const TOKEN = 'upstream-token-secret';

function setup(t, responses) {
  const keys = ['SYRVE_APP_ID', 'SYRVE_APP_CLIENT_SECRET', 'SYRVE_CREDENTIALS_SECRET',
    'NODE_ENV', 'RENDER_EXTERNAL_URL', 'JWT_SECRET'];
  const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  t.after(() => {
    for (const key of keys) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  });
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, ...options, body: JSON.parse(options.body) });
    const response = responses.shift();
    assert.ok(response, 'unexpected extra Syrve request');
    if (typeof response === 'function') return response(options);
    return response;
  });
  process.env.SYRVE_APP_ID = '';
  process.env.SYRVE_APP_CLIENT_SECRET = '';
  return { client: new SyrveClient(), calls };
}

function success(organizations = [{ id: ORG, name: 'MOLO' }]) {
  return [Response.json({ token: TOKEN }), Response.json({ organizations })];
}

function errorCode(code, secrets = [LOGIN, TOKEN]) {
  return (error) => {
    assert.equal(error.getStatus(), 502);
    assert.equal(error.getResponse().code, code);
    for (const secret of secrets) assert.ok(!JSON.stringify(error.getResponse()).includes(secret));
    return true;
  };
}

test('legacy diagnostics use only documented auth/organization endpoints and expose no secrets', async (t) => {
  const { client, calls } = setup(t, success());
  const result = await client.checkOrganizations(`${BASE}/`, ` ${LOGIN} `);
  assert.deepEqual(result.organizations, [{ id: ORG, name: 'MOLO' }]);
  assert.deepEqual(calls.map((call) => call.url), [`${BASE}/api/1/access_token`, `${BASE}/api/1/organizations`]);
  assert.deepEqual(calls[0].body, { apiLogin: LOGIN });
  assert.deepEqual(calls[1].body, { organizationIds: null, returnAdditionalInfo: false, includeDisabled: false });
  assert.equal(calls[1].headers.Authorization, `Bearer ${TOKEN}`);
  for (const call of calls) {
    assert.equal(call.redirect, 'error');
    assert.equal(call.method, 'POST');
    assert.ok(call.signal instanceof AbortSignal);
  }
  assert.deepEqual(result.diagnostics, {
    authentication: { status: 'ok', method: 'legacy_v1', deprecated: true },
    organizations: { status: 'ok', count: 1 },
    tables: { status: 'not_checked' }, orders: { status: 'not_checked' }, syncEnabled: false,
  });
  assert.ok(!JSON.stringify(result).includes(LOGIN));
  assert.ok(!JSON.stringify(result).includes(TOKEN));
});

test('v2 uses server application credentials and reports its authentication mode', async (t) => {
  const { client, calls } = setup(t, success());
  process.env.SYRVE_APP_ID = ORG;
  process.env.SYRVE_APP_CLIENT_SECRET = 'server-only-secret';
  const result = await client.checkOrganizations(BASE, LOGIN);
  assert.equal(calls[0].url, `${BASE}/api/v2/access_token`);
  assert.deepEqual(calls[0].body, { apiKey: LOGIN, appId: ORG, clientSecret: 'server-only-secret' });
  assert.deepEqual(result.diagnostics.authentication, { status: 'ok', method: 'v2', deprecated: false });
  assert.ok(!JSON.stringify(result).includes('server-only-secret'));
});

test('failed v2 authentication never silently falls back to v1', async (t) => {
  const { client, calls } = setup(t, [Response.json({ errorDescription: LOGIN }, { status: 401 })]);
  process.env.SYRVE_APP_ID = ORG;
  process.env.SYRVE_APP_CLIENT_SECRET = 'server-only-secret';
  await assert.rejects(client.checkOrganizations(BASE, LOGIN), errorCode('SYRVE_AUTH_FAILED'));
  assert.equal(calls.length, 1);
});

test('partial or invalid v2 configuration fails before sending credentials', async (t) => {
  const { client, calls } = setup(t, []);
  for (const [appId, secret] of [[ORG, ''], ['', 'secret'], ['invalid', 'secret']]) {
    process.env.SYRVE_APP_ID = appId;
    process.env.SYRVE_APP_CLIENT_SECRET = secret;
    await assert.rejects(client.checkOrganizations(BASE, LOGIN), (error) => error.getStatus() === 500);
  }
  assert.equal(calls.length, 0);
});

test('unverified hosts, URL credentials, paths, ports and fragments cannot receive secrets', async (t) => {
  const { client, calls } = setup(t, []);
  for (const url of ['http://api-eu.syrve.live', 'https://evil.syrve.live', 'https://iiko.cloud',
    'https://api-eu.syrve.live.evil.test', 'https://127.0.0.1', `${BASE}:444`, `${BASE}/api`,
    `${BASE}?key=secret`, `${BASE}#secret`, 'https://user:secret@api-eu.syrve.live', 'not-a-url']) {
    await assert.rejects(client.checkOrganizations(url, LOGIN), (error) => error.getStatus() === 400);
  }
  await assert.rejects(client.checkOrganizations(BASE, '     '), (error) => error.getStatus() === 400);
  assert.equal(calls.length, 0);
});

for (const [status, code] of [[401, 'SYRVE_AUTH_FAILED'], [403, 'SYRVE_ACCESS_DENIED'],
  [429, 'SYRVE_RATE_LIMITED'], [408, 'SYRVE_TIMEOUT'], [504, 'SYRVE_TIMEOUT'], [500, 'SYRVE_UNAVAILABLE']]) {
  test(`HTTP ${status} produces a controlled diagnostic without reading its error body`, async (t) => {
    const response = Response.json({ errorDescription: `${LOGIN} ${TOKEN}` }, { status });
    t.mock.method(response, 'text', () => assert.fail('must not read error bodies'));
    const { client } = setup(t, [response]);
    await assert.rejects(client.checkOrganizations(BASE, LOGIN), errorCode(code));
  });
}

test('offline and redirect failures are contained without reflecting fetch errors', async (t) => {
  const { client, calls } = setup(t, [() => { throw new Error(`${LOGIN} ${TOKEN}`); }]);
  await assert.rejects(client.checkOrganizations(BASE, LOGIN), errorCode('SYRVE_UNAVAILABLE'));
  assert.equal(calls.length, 1);
});

test('a stalled request is aborted at the existing 12 second deadline', async (t) => {
  const { client, calls } = setup(t, [({ signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
  })]);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = assert.rejects(client.checkOrganizations(BASE, LOGIN), errorCode('SYRVE_TIMEOUT'));
  t.mock.timers.tick(11_999);
  assert.equal(calls[0].signal.aborted, false);
  t.mock.timers.tick(1);
  await pending;
  assert.equal(calls[0].signal.aborted, true);
});

test('the deadline also covers reading a stalled response body', async (t) => {
  const { client } = setup(t, [({ signal }) => new Response(new ReadableStream({
    start(controller) {
      signal.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')), { once: true });
    },
  }), { headers: { 'content-type': 'application/json' } })]);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = assert.rejects(client.checkOrganizations(BASE, LOGIN), errorCode('SYRVE_TIMEOUT'));
  await Promise.resolve();
  t.mock.timers.tick(12_000);
  await pending;
});

for (const [label, response] of [
  ['HTML', () => new Response('<html>error</html>', { headers: { 'content-type': 'text/html' } })],
  ['invalid JSON', () => new Response('{bad', { headers: { 'content-type': 'application/json' } })],
  ['oversized length', () => Response.json({ token: TOKEN }, { headers: { 'content-length': '1048577' } })],
  ['oversized stream', () => new Response('x'.repeat(1_048_577), { headers: { 'content-type': 'application/json' } })],
  ['bare token', () => Response.json(TOKEN)], ['absent token', () => Response.json({})],
  ['non-string token', () => Response.json({ token: {} })],
  ['header injection', () => Response.json({ token: 'token\r\nsecret' })],
]) {
  test(`${label} is rejected as an invalid response`, async (t) => {
    const { client, calls } = setup(t, [response()]);
    await assert.rejects(client.checkOrganizations(BASE, LOGIN), errorCode('SYRVE_INVALID_RESPONSE'));
    assert.equal(calls.length, 1);
  });
}

for (const value of [null, [], {}, { organizations: {} }, { organizations: [null] },
  { organizations: [{ id: 'invalid', name: 'MOLO' }] },
  { organizations: [{ id: ORG, name: {} }] },
  { organizations: [{ id: ORG, name: 'MOLO' }, { id: ORG, name: 'duplicate' }] },
  { organizations: [{ id: ORG, name: 'x'.repeat(241) }] },
  { organizations: [{ id: ORG, name: 'valid' }, { organizationId: ORG, organizationName: 'alias' }] }]) {
  test(`organization payload is validated atomically: ${JSON.stringify(value).slice(0, 90)}`, async (t) => {
    const { client } = setup(t, [Response.json({ token: TOKEN }), Response.json(value)]);
    await assert.rejects(client.checkOrganizations(BASE, LOGIN), errorCode('SYRVE_INVALID_RESPONSE'));
  });
}

test('empty organizations are not reported as a successful connection', async (t) => {
  const { client } = setup(t, success([]));
  await assert.rejects(client.checkOrganizations(BASE, LOGIN), errorCode('SYRVE_NO_ORGANIZATIONS'));
});

test('documented nullable organization names and additional fields are handled safely', async (t) => {
  const { client } = setup(t, success([{ id: ORG, name: null, responseType: 'Simple', ignored: TOKEN }]));
  const result = await client.checkOrganizations(BASE, LOGIN);
  assert.deepEqual(result.organizations, [{ id: ORG, name: 'Організація без назви' }]);
  assert.ok(!JSON.stringify(result).includes(TOKEN));
});
