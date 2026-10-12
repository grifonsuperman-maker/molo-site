const assert = require('node:assert/strict');
const test = require('node:test');
const { SyrveClient } = require('../dist/syrve/syrve-client.js');
const { SyrveIntegrationService } = require('../dist/syrve/syrve-integration.service.js');
const { syrveWebhookReceiverUrl, parseSyrveWebhookSetupSettings, syrveWebhookUpdatePayload } = require('../dist/syrve/syrve-webhook-setup.js');
const { syrveWebhookToken } = require('../dist/syrve/syrve-webhook.js');
const ORG = 'a0000000-0000-4000-8000-000000000001', REV = 'b0000000-0000-4000-8000-000000000001';
const OTHER = 'c0000000-0000-4000-8000-000000000001', BASE = 'https://api-eu.syrve.live';
const ORIGIN = 'https://molo-backend-fixture.onrender.com', TARGET = ORIGIN + '/api/syrve-webhook/' + REV;
const LOGIN = 'fixture-api-secret';
const ITEM_STATUSES = ['Added', 'PrintedNotCooking', 'CookingStarted', 'CookingCompleted', 'Served'];
function environment(t) {
  const values = { SYRVE_CREDENTIALS_SECRET: 'fixture-webhook-root-secret', SYRVE_APP_ID: '', SYRVE_APP_CLIENT_SECRET: '',
    SYRVE_WEBHOOK_BASE_URL: '', RENDER_EXTERNAL_URL: ORIGIN };
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  t.after(() => Object.entries(previous).forEach(([key, value]) => value === undefined ? delete process.env[key] : process.env[key] = value));
}
const empty = () => ({ correlationId: REV, apiLoginName: 'private-login-name', webHooksUri: null, authToken: null, webHooksFilter: null });
const configured = () => ({ ...empty(), webHooksUri: TARGET, authToken: syrveWebhookToken(REV),
  webHooksFilter: { tableOrderFilter: { orderStatuses: ['New', 'Bill', 'Closed', 'Deleted'], itemStatuses: null, errors: false } } });
const auth = () => [Response.json({ token: 'fixture-provider-token' }), Response.json({ organizations: [{ id: ORG, name: 'MOLO' }] })];
function transport(t, responses) {
  environment(t); const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ path: new URL(url).pathname, body: JSON.parse(options.body) });
    const value = responses.shift(); assert.ok(value, 'unexpected provider request');
    return typeof value === 'function' ? value(calls.at(-1)) : value;
  });
  return { calls, client: new SyrveClient(require('./helpers/syrve-test-request-limiter.js')) };
}

test('setup reads, writes once and verifies URL, token and every bill status without exposing raw settings', async t => {
  const initial = { ...empty(), webHooksFilter: { reserveFilter: { updates: true, errors: true },
    deliveryOrderFilter: { errors: false, returnedExternalDataKeys: ['private-external-key'] } } };
  let saved;
  const h = transport(t, [...auth(), Response.json(initial), call => {
    saved = { ...empty(), ...call.body }; return Response.json({ correlationId: OTHER });
  }, () => Response.json(saved)]);
  const result = await h.client.configureWebhook(BASE, LOGIN, ORG, TARGET, async () => {});
  assert.deepEqual(h.calls.map(call => call.path), ['/api/1/access_token', '/api/1/organizations',
    '/api/1/webhooks/settings', '/api/1/webhooks/update_settings', '/api/1/webhooks/settings']);
  assert.equal(h.calls[3].body.organizationId, ORG); assert.equal(h.calls[3].body.webHooksUri, TARGET);
  assert.equal(h.calls[3].body.authToken, syrveWebhookToken(REV));
  assert.deepEqual(h.calls[3].body.webHooksFilter.reserveFilter, initial.webHooksFilter.reserveFilter);
  assert.deepEqual(h.calls[3].body.webHooksFilter.deliveryOrderFilter, initial.webHooksFilter.deliveryOrderFilter);
  assert.deepEqual(h.calls[3].body.webHooksFilter.tableOrderFilter.itemStatuses, ITEM_STATUSES);
  assert.equal(result.settingsWriteAccess, 'confirmed'); assert.equal(result.settingsChanged, true);
  assert.equal(result.notificationsConfigured, true); assert.equal(result.statusesApplied, false); assert.equal(result.deliveryVerified, false);
  assert.doesNotMatch(JSON.stringify(result), /private-|fixture-|onrender|apiLogin|authToken|webHooksUri|webHooksFilter/);
});

test('an already configured receiver is read without another write or a false write-permission claim', async t => {
  const h = transport(t, [...auth(), () => Response.json(configured())]);
  const result = await h.client.configureWebhook(BASE, LOGIN, ORG, TARGET, async () => {});
  assert.equal(h.calls.length, 3); assert.equal(result.settingsChanged, false);
  assert.equal(result.settingsWriteAccess, 'not_checked'); assert.equal(result.notificationsConfigured, true);
});

test('all documented item states returned by Syrve confirm setup after one write', async t => {
  const h = transport(t, [...auth(), Response.json(empty()), Response.json({ correlationId: REV }), () => {
    const settings = configured();
    settings.webHooksFilter.tableOrderFilter.itemStatuses = [...ITEM_STATUSES].reverse();
    return Response.json(settings);
  }]);
  const result = await h.client.configureWebhook(BASE, LOGIN, ORG, TARGET, async () => {});
  assert.deepEqual(h.calls[3].body.webHooksFilter.tableOrderFilter.itemStatuses, ITEM_STATUSES);
  assert.equal(result.notificationsConfigured, true); assert.equal(result.settingsWriteAccess, 'confirmed');
  assert.equal(result.settingsChanged, true); assert.equal(result.deliveryVerified, false);
  assert.equal(h.calls.length, 5);
  assert.equal(h.calls.filter(call => call.path.endsWith('/update_settings')).length, 1);
  assert.equal(h.calls.at(-1).path, '/api/1/webhooks/settings');
  assert.doesNotMatch(JSON.stringify(result), /private-|fixture-|onrender|authToken|webHooksUri|webHooksFilter/);
});

test('a full item-state list or legacy unrestricted filter needs no rewrite', async t => {
  for (const states of [ITEM_STATUSES, [...ITEM_STATUSES].reverse(), null, undefined]) {
    const h = transport(t, [...auth(), () => {
      const settings = configured();
      if (states === undefined) delete settings.webHooksFilter.tableOrderFilter.itemStatuses;
      else settings.webHooksFilter.tableOrderFilter.itemStatuses = states;
      return Response.json(settings);
    }]);
    const result = await h.client.configureWebhook(BASE, LOGIN, ORG, TARGET, async () => {});
    assert.equal(result.notificationsConfigured, true); assert.equal(result.settingsChanged, false);
    assert.equal(result.settingsWriteAccess, 'not_checked'); assert.equal(result.deliveryVerified, false);
    assert.equal(h.calls.length, 3);
    assert.equal(h.calls.filter(call => call.path.endsWith('/update_settings')).length, 0);
  }
});

test('empty, incomplete, duplicated, unknown or malformed item-state readback never confirms setup', async t => {
  for (const states of [[], ['Added'], [...ITEM_STATUSES, 'Unknown'],
    ['Added', 'PrintedNotCooking', 'CookingStarted', 'CookingCompleted', 'Added'],
    ['Added', 'PrintedNotCooking', 'CookingStarted', 'CookingCompleted', 'Unknown'], 'Served', {}, 0]) {
    const h = transport(t, [...auth(), Response.json(empty()), Response.json({ correlationId: REV }), () => {
      const settings = configured(); settings.webHooksFilter.tableOrderFilter.itemStatuses = states;
      return Response.json(settings);
    }]);
    await assert.rejects(h.client.configureWebhook(BASE, LOGIN, ORG, TARGET, async () => {}), error => {
      assert.equal(error.getResponse().code, 'SYRVE_WEBHOOK_ITEM_FILTER_NOT_CONFIRMED');
      assert.doesNotMatch(JSON.stringify(error.getResponse()), /private-|fixture-|onrender|Unknown/);
      return true;
    });
    assert.equal(h.calls.length, 5);
    assert.equal(h.calls.filter(call => call.path.endsWith('/update_settings')).length, 1);
  }
});

test('foreign or unprovable callbacks are never overwritten, including a matching host with the wrong secret', async t => {
  for (const settings of [{ ...empty(), webHooksUri: 'https://private-user:private-password@foreign.example/hook?private-query', authToken: 'private-token' },
    { ...empty(), webHooksUri: TARGET, authToken: 'private-token' },
    { ...empty(), webHooksUri: ORIGIN + '/api/other-hook/' + REV, authToken: 'private-token' }]) {
    const h = transport(t, [...auth(), Response.json(settings)]);
    await assert.rejects(h.client.configureWebhook(BASE, LOGIN, ORG, TARGET, async () => {}), error => {
      assert.equal(error.getStatus(), 409); assert.doesNotMatch(JSON.stringify(error.getResponse()), /private-|foreign\.example/); return true;
    });
    assert.equal(h.calls.length, 3);
  }
});

test('a proven earlier MOLO revision can be rotated and unrelated filters remain intact', t => {
  environment(t);
  const previous = { ...configured(), webHooksUri: ORIGIN + '/api/syrve-webhook/' + OTHER, authToken: 'Bearer ' + syrveWebhookToken(OTHER) };
  const planned = syrveWebhookUpdatePayload(parseSyrveWebhookSetupSettings(previous), ORG, TARGET);
  assert.equal(planned.webHooksUri, TARGET); assert.equal(planned.authToken, syrveWebhookToken(REV));
  assert.equal(previous.webHooksUri, ORIGIN + '/api/syrve-webhook/' + OTHER);
});

test('write denial, timeout and rate limit never retry the mutation or leak provider error bodies', async t => {
  for (const [status, code] of [[403, 'SYRVE_WEBHOOK_WRITE_DENIED'], [401, 'SYRVE_AUTH_FAILED'], [429, 'SYRVE_RATE_LIMITED'], [504, 'SYRVE_TIMEOUT']]) {
    const h = transport(t, [...auth(), Response.json(empty()), Response.json({ secret: 'private-provider-body' }, { status })]);
    await assert.rejects(h.client.configureWebhook(BASE, LOGIN, ORG, TARGET, async () => {}), error => {
      assert.equal(error.getResponse().code, code); assert.doesNotMatch(JSON.stringify(error.getResponse()), /private-|fixture-/); return true;
    });
    assert.equal(h.calls.filter(call => call.path.endsWith('/update_settings')).length, 1);
    assert.equal(h.calls.length, 4);
  }
});

test('failed or mismatched readback never reports a verified setup after an accepted write', async t => {
  for (const [change, code] of [
    [value => value.authToken = 'private-wrong-secret', 'SYRVE_WEBHOOK_AUTHORIZATION_NOT_CONFIRMED'],
    [value => value.webHooksUri = 'https://private.example/hook', 'SYRVE_WEBHOOK_ADDRESS_NOT_CONFIRMED'],
    [value => value.webHooksFilter.tableOrderFilter = null, 'SYRVE_WEBHOOK_TABLE_FILTER_NOT_CONFIRMED'],
    [value => value.webHooksFilter.tableOrderFilter.orderStatuses = ['New', 'Bill'], 'SYRVE_WEBHOOK_ORDER_STATUSES_NOT_CONFIRMED'],
    [value => value.webHooksFilter.tableOrderFilter.itemStatuses = ['Added'], 'SYRVE_WEBHOOK_ITEM_FILTER_NOT_CONFIRMED'],
  ]) {
    const h = transport(t, [...auth(), Response.json(empty()), Response.json({ correlationId: REV }), () => {
      const settings = configured(); change(settings); return Response.json(settings);
    }]);
    await assert.rejects(h.client.configureWebhook(BASE, LOGIN, ORG, TARGET, async () => {}), error => {
      assert.equal(error.getResponse().code, code);
      assert.doesNotMatch(JSON.stringify(error.getResponse()), /private-|fixture-|onrender/); return true;
    });
    assert.equal(h.calls.length, 5);
    assert.equal(h.calls.filter(call => call.path.endsWith('/update_settings')).length, 1);
  }
});

test('malformed initial settings stop before any mutation', async t => {
  for (const bad of [{ ...empty(), webHooksFilter: [] }, { ...empty(), webHooksFilter: { tableOrderFilter: 'private-value' } },
    { ...empty(), correlationId: 'bad' }]) {
    const h = transport(t, [...auth(), Response.json(bad)]);
    await assert.rejects(h.client.configureWebhook(BASE, LOGIN, ORG, TARGET, async () => {}), error => error.getResponse().code === 'SYRVE_INVALID_RESPONSE');
    assert.equal(h.calls.length, 3);
  }
});

test('an incomplete 200 acknowledgement still requires fresh matching readback and never retries the write', async t => {
  for (const acknowledgement of [{ privateAck: 'private-value' }, { correlationId: 'private-invalid-id' }, null]) {
    const h = transport(t, [...auth(), Response.json(empty()), Response.json(acknowledgement), () => Response.json(configured())]);
    const result = await h.client.configureWebhook(BASE, LOGIN, ORG, TARGET, async () => {});
    assert.equal(result.notificationsConfigured, true); assert.equal(result.settingsWriteAccess, 'confirmed');
    assert.equal(result.deliveryVerified, false); assert.equal(h.calls.length, 5);
    assert.equal(h.calls.filter(call => call.path.endsWith('/update_settings')).length, 1);
    assert.equal(h.calls.at(-1).path, '/api/1/webhooks/settings');
    assert.doesNotMatch(JSON.stringify(result), /private-|fixture-|onrender/);
  }
});

test('an incomplete acknowledgement cannot conceal unchanged settings or a failed verification read', async t => {
  for (const [readback, code] of [[Response.json(empty()), 'SYRVE_WEBHOOK_ADDRESS_NOT_CONFIRMED'],
    [Response.json({ privateError: 'private-value' }, { status: 503 }), 'SYRVE_UNAVAILABLE']]) {
    const h = transport(t, [...auth(), Response.json(empty()), Response.json({ privateAck: 'private-value' }), readback]);
    await assert.rejects(h.client.configureWebhook(BASE, LOGIN, ORG, TARGET, async () => {}), error => {
      assert.equal(error.getResponse().code, code); assert.doesNotMatch(JSON.stringify(error.getResponse()), /private-/); return true;
    });
    assert.equal(h.calls.length, 5); assert.equal(h.calls.filter(call => call.path.endsWith('/update_settings')).length, 1);
  }
});

test('saved-scope or Director revocation after the initial read blocks the write', async t => {
  let revoked = false;
  const h = transport(t, [...auth(), () => { revoked = true; return Response.json(empty()); }]);
  await assert.rejects(h.client.configureWebhook(BASE, LOGIN, ORG, TARGET, async () => { if (revoked) throw new Error('revoked'); }), /revoked/);
  assert.equal(h.calls.length, 3);
});

test('receiver origin comes only from a public HTTPS runtime setting and rejects credentials, paths and private hosts', t => {
  environment(t);
  assert.equal(syrveWebhookReceiverUrl(REV), TARGET);
  for (const value of ['http://backend.example', 'https://user:private-secret@backend.example', 'https://backend.example/private',
    'https://backend.example?private-secret', 'https://backend.example#private-secret', 'https://127.0.0.1', 'https://[::1]',
    'https://localhost', 'https://server.internal', 'https://backend.example:8443']) {
    process.env.SYRVE_WEBHOOK_BASE_URL = value;
    assert.throws(() => syrveWebhookReceiverUrl(REV), error => { assert.equal(error.getStatus(), 503); assert.doesNotMatch(error.message, /private-secret/); return true; });
  }
  process.env.SYRVE_WEBHOOK_BASE_URL = 'https://owned-backend.example';
  assert.equal(syrveWebhookReceiverUrl(REV), 'https://owned-backend.example/api/syrve-webhook/' + REV);
});

function serviceHarness(t, mutate) {
  environment(t);
  const saved = { prepared: true, links: [], entity: { id: ORG, configurationRevision: REV, status: 'connected',
    organizationId: ORG, apiBaseUrl: BASE, apiLoginEncrypted: 'encrypted', apiLoginIv: 'iv', apiLoginAuthTag: 'tag' } };
  let enabled = true, calls = 0;
  const noWrite = () => assert.fail('setup must not write MOLO tables, settings, statuses or logs');
  const store = { read: async () => structuredClone(saved), save: noWrite, transaction: noWrite };
  const service = new SyrveIntegrationService(store, { create: noWrite }, { configureWebhook: async (base, login, org, target, guard) => {
    assert.equal(base, BASE); assert.equal(login, LOGIN); assert.equal(org, ORG); assert.equal(target, TARGET);
    calls++; await guard(); mutate?.(saved); await guard();
    return { notificationsConfigured: true, statusesApplied: false, deliveryVerified: false };
  } }, { find: noWrite, save: noWrite }, { read: async () => ({ enabled }) });
  t.mock.method(service, 'decrypt', () => LOGIN);
  return { service, saved, calls: () => calls, disable: () => enabled = false };
}
test('service uses saved credentials and consent without changing any local business data', async t => {
  const h = serviceHarness(t), before = structuredClone(h.saved);
  const result = await h.service.configureWebhook({ configurationRevision: REV, confirmed: true });
  assert.equal(result.configurationRevision, REV); assert.equal(result.organizationId, ORG); assert.equal(h.calls(), 1);
  assert.deepEqual(h.saved, before); assert.doesNotMatch(JSON.stringify(result), /fixture-|encrypted|onrender/);
});
test('confirmation, current credentials, organization, revision and enabled auto-status fence configuration', async t => {
  const noConsent = serviceHarness(t); noConsent.disable();
  await assert.rejects(noConsent.service.configureWebhook({ configurationRevision: REV, confirmed: true }), error => error.getStatus() === 409);
  assert.equal(noConsent.calls(), 0);
  const unconfirmed = serviceHarness(t);
  await assert.rejects(unconfirmed.service.configureWebhook({ configurationRevision: REV, confirmed: false }), error => error.getStatus() === 400);
  assert.equal(unconfirmed.calls(), 0);
  for (const mutate of [s => s.entity.configurationRevision = OTHER, s => s.entity.organizationId = OTHER,
    s => s.entity.apiLoginEncrypted = 'rotated', s => s.entity.status = 'not_connected']) {
    const h = serviceHarness(t, mutate);
    await assert.rejects(h.service.configureWebhook({ configurationRevision: REV, confirmed: true }), error => error.getStatus() === 409);
  }
});
