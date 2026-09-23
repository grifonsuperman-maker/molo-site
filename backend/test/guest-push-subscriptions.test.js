const assert = require('node:assert/strict');
const test = require('node:test');

const {
  GuestPushService,
  hashGuestPushValue,
  resolveGuestPushConfig,
} = require('../dist/guest-push/guest-push.service.js');

const PUBLIC_KEY = 'B' + 'A'.repeat(86);

function configService(values = {}) {
  return {
    get(key) {
      return values[key];
    },
  };
}

function bookingRepository(booking) {
  const query = {
    addSelect() { return this; },
    where() { return this; },
    andWhere() { return this; },
    async getOne() { return booking; },
  };
  return {
    createQueryBuilder() {
      return query;
    },
  };
}

function registration(overrides = {}) {
  return {
    bookingId: '9c8f6f02-c35f-4f5b-b171-8f61ff53a728',
    guestAccessToken: 'guest-private-token',
    guestDeviceId: 'guest-device-123',
    subscription: {
      endpoint: 'https://push.example/subscriptions/abc',
      expirationTime: null,
      keys: {
        p256dh: 'Abc_123-xyz',
        auth: 'Auth_123-xyz',
      },
    },
    ...overrides,
  };
}

test('guest push config stays disabled unless explicitly enabled with a VAPID public key', () => {
  assert.deepEqual(resolveGuestPushConfig(undefined, undefined), { enabled: false });
  assert.deepEqual(resolveGuestPushConfig('true', 'not-a-vapid-key'), { enabled: false });
  assert.deepEqual(resolveGuestPushConfig('false', PUBLIC_KEY), { enabled: false });
  assert.deepEqual(resolveGuestPushConfig('true', PUBLIC_KEY), {
    enabled: true,
    vapidPublicKey: PUBLIC_KEY,
  });
});

test('registration proves booking token ownership and stores only hashes for guest identity', async () => {
  const dto = registration();
  const upserts = [];
  const service = new GuestPushService(
    {
      async upsert(value, options) {
        upserts.push({ value, options });
      },
    },
    bookingRepository({
      id: dto.bookingId,
      status: 'approved',
      guestDeviceIdHash: hashGuestPushValue(dto.guestDeviceId),
    }),
    configService({
      GUEST_PUSH_ENABLED: 'true',
      GUEST_PUSH_VAPID_PUBLIC_KEY: PUBLIC_KEY,
    }),
  );

  assert.deepEqual(await service.register(dto), { enabled: true });
  assert.equal(upserts.length, 1);
  assert.equal(upserts[0].value.bookingId, dto.bookingId);
  assert.equal(upserts[0].value.guestDeviceIdHash, hashGuestPushValue(dto.guestDeviceId));
  assert.equal(upserts[0].value.endpointHash, hashGuestPushValue(dto.subscription.endpoint));
  assert.equal(upserts[0].value.endpoint, dto.subscription.endpoint);
  assert.equal(Object.hasOwn(upserts[0].value, 'guestAccessToken'), false);
  assert.equal(Object.hasOwn(upserts[0].value, 'guestDeviceId'), false);
  assert.deepEqual(upserts[0].options.conflictPaths, ['bookingId', 'endpointHash']);
});

test('registration rejects a token that does not resolve to the booking', async () => {
  const service = new GuestPushService(
    { upsert: async () => { throw new Error('must not write'); } },
    bookingRepository(null),
    configService({
      GUEST_PUSH_ENABLED: 'true',
      GUEST_PUSH_VAPID_PUBLIC_KEY: PUBLIC_KEY,
    }),
  );

  await assert.rejects(() => service.register(registration()), /Недійсний доступ/);
});

test('registration rejects a mismatched device for bookings that already have a device hash', async () => {
  const service = new GuestPushService(
    { upsert: async () => { throw new Error('must not write'); } },
    bookingRepository({
      status: 'pending',
      guestDeviceIdHash: hashGuestPushValue('another-device'),
    }),
    configService({
      GUEST_PUSH_ENABLED: 'true',
      GUEST_PUSH_VAPID_PUBLIC_KEY: PUBLIC_KEY,
    }),
  );

  await assert.rejects(() => service.register(registration()), /Недійсний доступ/);
});

test('legacy token booking without a stored device hash can register the current browser device', async () => {
  let stored;
  const service = new GuestPushService(
    { async upsert(value) { stored = value; } },
    bookingRepository({ status: 'pending', guestDeviceIdHash: null }),
    configService({
      GUEST_PUSH_ENABLED: 'true',
      GUEST_PUSH_VAPID_PUBLIC_KEY: PUBLIC_KEY,
    }),
  );

  await service.register(registration());
  assert.equal(stored.guestDeviceIdHash, hashGuestPushValue('guest-device-123'));
});

test('registration refuses inactive bookings and malformed push endpoints', async () => {
  const config = configService({
    GUEST_PUSH_ENABLED: 'true',
    GUEST_PUSH_VAPID_PUBLIC_KEY: PUBLIC_KEY,
  });

  const inactive = new GuestPushService(
    { upsert: async () => { throw new Error('must not write'); } },
    bookingRepository({ status: 'completed', guestDeviceIdHash: null }),
    config,
  );
  await assert.rejects(() => inactive.register(registration()), /вже недоступні/);

  const invalidEndpoint = new GuestPushService(
    { upsert: async () => { throw new Error('must not write'); } },
    bookingRepository({ status: 'approved', guestDeviceIdHash: null }),
    config,
  );
  await assert.rejects(
    () => invalidEndpoint.register(registration({
      subscription: {
        endpoint: 'http://push.example/subscriptions/abc',
        keys: { p256dh: 'Abc_123-xyz', auth: 'Auth_123-xyz' },
      },
    })),
    /Некоректна Push-підписка/,
  );
});

test('registration endpoint cannot write while guest push is disabled', async () => {
  const service = new GuestPushService(
    { upsert: async () => { throw new Error('must not write'); } },
    bookingRepository({ status: 'approved', guestDeviceIdHash: null }),
    configService({
      GUEST_PUSH_ENABLED: 'false',
      GUEST_PUSH_VAPID_PUBLIC_KEY: PUBLIC_KEY,
    }),
  );

  await assert.rejects(() => service.register(registration()), /ще не увімкнені/);
});


test('migration-managed entity stays out of synchronize', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(
    path.resolve(__dirname, '../src/guest-push/entities/guest-push-subscription.entity.ts'),
    'utf8',
  );
  assert.match(
    source,
    /@Entity\(\{\s*name:\s*'guest_push_subscriptions',\s*synchronize:\s*false\s*\}\)/,
  );
});
