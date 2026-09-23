require('reflect-metadata');

const assert = require('node:assert/strict');
const { createECDH } = require('node:crypto');
const test = require('node:test');

const {
  GuestPushService,
  resolveGuestPushConfig,
} = require('../dist/guest-push/guest-push.service.js');
const {
  isPublicGuestPushAddress,
  isRecognizedGuestPushEndpoint,
} = require('../dist/guest-push/guest-push-endpoint.js');

const vapidEcdh = createECDH('prime256v1');
vapidEcdh.setPrivateKey(Buffer.alloc(32, 7));
const PRIVATE_KEY = vapidEcdh.getPrivateKey().toString('base64url');
const PUBLIC_KEY = vapidEcdh.getPublicKey().toString('base64url');
const SUBJECT = 'https://push.example.test';

function config(overrides = {}) {
  const values = {
    GUEST_PUSH_ENABLED: 'true',
    GUEST_PUSH_VAPID_PUBLIC_KEY: PUBLIC_KEY,
    GUEST_PUSH_VAPID_PRIVATE_KEY: PRIVATE_KEY,
    GUEST_PUSH_VAPID_SUBJECT: SUBJECT,
    ...overrides,
  };
  return { get: (key) => values[key] };
}

function subscription(endpoint, endpointHash) {
  return {
    bookingId: 'booking-1',
    endpointHash,
    guestDeviceIdHash: 'd'.repeat(64),
    endpoint,
    p256dh: 'p256dh-value',
    auth: 'auth-value',
  };
}

test('sender readiness requires complete VAPID configuration without exposing secrets', () => {
  assert.deepEqual(
    resolveGuestPushConfig('true', PUBLIC_KEY, undefined, SUBJECT),
    { enabled: false },
  );
  assert.deepEqual(
    resolveGuestPushConfig('true', PUBLIC_KEY, PRIVATE_KEY, undefined),
    { enabled: false },
  );
  assert.deepEqual(
    resolveGuestPushConfig('true', PUBLIC_KEY, PRIVATE_KEY, SUBJECT),
    { enabled: true, vapidPublicKey: PUBLIC_KEY },
  );
  const anotherPair = createECDH('prime256v1');
  anotherPair.setPrivateKey(Buffer.alloc(32, 9));
  assert.deepEqual(
    resolveGuestPushConfig(
      'true',
      PUBLIC_KEY,
      anotherPair.getPrivateKey().toString('base64url'),
      SUBJECT,
    ),
    { enabled: false },
  );
});

test('only recognized browser Push services are accepted and private addresses are rejected', () => {
  for (const endpoint of [
    'https://fcm.googleapis.com/fcm/send/token',
    'https://updates.push.services.mozilla.com/wpush/v2/token',
    'https://web.push.apple.com/QPush/token',
    'https://wns2-sg2p.notify.windows.com/w/?token=value',
  ]) {
    assert.equal(isRecognizedGuestPushEndpoint(new URL(endpoint)), true);
  }

  for (const endpoint of [
    'https://example.com/internal',
    'https://fcm.googleapis.com.evil.example/fcm/send/token',
    'https://push.apple.com.evil.example/token',
    'https://fcm.googleapis.com:8443/fcm/send/token',
    'https://user:pass@fcm.googleapis.com/fcm/send/token',
    'https://fcm.googleapis.com/fcm/send/token#fragment',
  ]) {
    assert.equal(isRecognizedGuestPushEndpoint(new URL(endpoint)), false);
  }

  for (const address of [
    '10.0.0.1',
    '127.0.0.1',
    '169.254.169.254',
    '192.168.1.1',
    '::1',
    'fc00::1',
    'fe80::1',
  ]) {
    assert.equal(isPublicGuestPushAddress(address), false);
  }
  assert.equal(isPublicGuestPushAddress('8.8.8.8'), true);
  assert.equal(isPublicGuestPushAddress('2606:4700:4700::1111'), true);
});

test('transport keeps VAPID credentials request-scoped', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(
    path.resolve(__dirname, '../src/guest-push/guest-push.transport.ts'),
    'utf8',
  );

  assert.doesNotMatch(source, /setVapidDetails/);
  assert.match(source, /await assertSafeGuestPushDeliveryEndpoint\(subscription\.endpoint\)/);
  const guardSource = fs.readFileSync(
    path.resolve(__dirname, '../src/guest-push/guest-push-endpoint.ts'),
    'utf8',
  );
  assert.match(guardSource, /2_000/);
  assert.match(guardSource, /Web Push DNS lookup timed out/);
  assert.match(source, /vapidDetails:\s*credentials/);
  assert.match(source, /TTL:\s*60 \* 60/);
  assert.match(source, /timeout:\s*5_000/);
});

test('booking Push sends every endpoint with only category and body', async () => {
  const rows = [
    subscription('https://push.example.test/sub/a', 'a'.repeat(64)),
    subscription('https://push.example.test/sub/b', 'b'.repeat(64)),
  ];
  const sent = [];
  const repository = {
    async find(options) {
      assert.deepEqual(options, { where: { bookingId: 'booking-1' } });
      return rows;
    },
    async delete() {},
  };
  const transport = {
    async send(pushSubscription, payload, credentials) {
      sent.push({ pushSubscription, payload, credentials });
      return { statusCode: 201 };
    },
  };
  const service = new GuestPushService(repository, {}, config(), transport);

  const result = await service.sendBookingNotification(
    'booking-1',
    'Зміну часу підтверджено',
  );

  assert.deepEqual(result, { attempted: 2, delivered: 2, failed: 0 });
  assert.equal(sent.length, 2);
  for (const item of sent) {
    assert.deepEqual(JSON.parse(item.payload), {
      category: 'booking',
      body: 'Зміну часу підтверджено',
    });
    assert.equal(item.payload.includes('booking-1'), false);
    assert.equal(item.payload.includes('guestDeviceId'), false);
    assert.deepEqual(item.credentials, {
      publicKey: PUBLIC_KEY,
      privateKey: PRIVATE_KEY,
      subject: SUBJECT,
    });
  }
});

test('stale endpoints are removed and other delivery failures stay isolated', async () => {
  const rows = [
    subscription('https://push.example.test/sub/a', 'a'.repeat(64)),
    subscription('https://push.example.test/sub/b', 'b'.repeat(64)),
  ];
  const deleted = [];
  const repository = {
    async find() { return rows; },
    async delete(where) { deleted.push(where); },
  };
  const transport = {
    async send(pushSubscription) {
      const error = new Error('delivery failed');
      error.statusCode = pushSubscription.endpoint.endsWith('/a') ? 410 : 503;
      throw error;
    },
  };
  const service = new GuestPushService(repository, {}, config(), transport);

  const result = await service.sendBookingNotification(
    'booking-1',
    'Бронювання оновлено',
  );

  assert.deepEqual(result, { attempted: 2, delivered: 0, failed: 2 });
  assert.deepEqual(deleted, [{
    bookingId: 'booking-1',
    endpointHash: 'a'.repeat(64),
    p256dh: 'p256dh-value',
    auth: 'auth-value',
  }]);
});

test('disabled sender skips storage and body is capped at worker limit', async () => {
  let findCalls = 0;
  const disabled = new GuestPushService(
    { async find() { findCalls += 1; return []; } },
    {},
    config({ GUEST_PUSH_VAPID_PRIVATE_KEY: '' }),
    { async send() {} },
  );
  assert.deepEqual(
    await disabled.sendBookingNotification('booking-1', 'message'),
    { attempted: 0, delivered: 0, failed: 0 },
  );
  assert.equal(findCalls, 0);

  let body = '';
  const enabled = new GuestPushService(
    {
      async find() {
        return [subscription(
          'https://push.example.test/sub/a',
          'a'.repeat(64),
        )];
      },
      async delete() {},
    },
    {},
    config(),
    {
      async send(_subscription, payload) {
        body = JSON.parse(payload).body;
      },
    },
  );
  await enabled.sendBookingNotification('booking-1', 'x'.repeat(700));
  assert.equal(body.length, 500);
});
