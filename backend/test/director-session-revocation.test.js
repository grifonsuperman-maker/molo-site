const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { after, test } = require('node:test');

const { AuthService } = require('../dist/auth/auth.service.js');
const {
  AddDirectorSessionVersion2026091800010,
} = require('../dist/migrations/2026091800010-AddDirectorSessionVersion.js');

const previousJwtSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'director-session-test-secret';

after(() => {
  if (previousJwtSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousJwtSecret;
});

function createDirector(version) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    telegramId: null,
    fullName: 'Директор MOLO',
    role: 'owner',
    active: true,
    isArchived: false,
    isOnShift: false,
    directorSessionVersion: version,
  };
}

function createPayload(director, version) {
  return {
    sub: director.id,
    telegramId: `staff:${director.id}`,
    staffId: director.id,
    role: 'owner',
    name: director.fullName,
    ...(version === undefined ? {} : { directorSessionVersion: version }),
  };
}

test('old Director sessions are rejected while the renewed session remains valid', async () => {
  const director = createDirector(2);
  const payloads = {
    'old-token': createPayload(director, 1),
    'renewed-token': createPayload(director, 2),
  };
  const service = new AuthService(
    { findOne: async () => director },
    { verifyAsync: async (token) => payloads[token] },
  );

  await assert.rejects(
    () => service.verifyToken('old-token'),
    /Недійсний токен авторизації/,
  );

  const renewed = await service.verifyToken('renewed-token');
  assert.equal(renewed.role, 'owner');
  assert.equal(renewed.directorSessionVersion, 2);
});

test('existing Director sessions keep working until credentials are changed', async () => {
  const director = createDirector(1);
  const legacyPayload = createPayload(director);
  const service = new AuthService(
    { findOne: async () => director },
    { verifyAsync: async () => legacyPayload },
  );

  const beforeChange = await service.verifyToken('legacy-token');
  assert.equal(beforeChange.role, 'owner');

  director.directorSessionVersion = 2;
  await assert.rejects(
    () => service.verifyToken('legacy-token'),
    /Недійсний токен авторизації/,
  );
});

test('Telegram authentication issues a Director token with the current session version', async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousRenderExternalUrl = process.env.RENDER_EXTERNAL_URL;
  const previousAllowDevAuth = process.env.ALLOW_DEV_AUTH;
  process.env.NODE_ENV = 'development';
  delete process.env.RENDER_EXTERNAL_URL;
  process.env.ALLOW_DEV_AUTH = 'true';

  const director = createDirector(4);
  director.telegramId = '123456';
  let signedPayload = null;
  const service = new AuthService(
    { findOne: async () => director },
    {
      signAsync: async (payload) => {
        signedPayload = payload;
        return 'telegram-director-token';
      },
    },
  );

  try {
    const result = await service.authenticateTelegram({
      devTelegramId: director.telegramId,
      devName: director.fullName,
    });

    assert.equal(result.accessToken, 'telegram-director-token');
    assert.equal(signedPayload.directorSessionVersion, 4);
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;

    if (previousRenderExternalUrl === undefined) {
      delete process.env.RENDER_EXTERNAL_URL;
    } else {
      process.env.RENDER_EXTERNAL_URL = previousRenderExternalUrl;
    }

    if (previousAllowDevAuth === undefined) delete process.env.ALLOW_DEV_AUTH;
    else process.env.ALLOW_DEV_AUTH = previousAllowDevAuth;
  }
});

test('Director session migration has safe forward and rollback operations', async () => {
  const queries = [];
  const queryRunner = {
    async query(sql) {
      queries.push(String(sql));
    },
  };
  const migration = new AddDirectorSessionVersion2026091800010();

  await migration.up(queryRunner);
  assert.match(queries[0], /ALTER TABLE "staff"/);
  assert.match(
    queries[0],
    /ADD COLUMN IF NOT EXISTS "director_session_version" integer NOT NULL DEFAULT 1/,
  );

  await migration.down(queryRunner);
  assert.match(
    queries.at(-1),
    /DROP COLUMN IF EXISTS "director_session_version"/,
  );

  const appModuleSource = fs.readFileSync(
    path.join(__dirname, '../src/app.module.ts'),
    'utf8',
  );
  assert.match(
    appModuleSource,
    /AddDirectorSessionVersion2026091800010.*2026091800010-AddDirectorSessionVersion/,
  );
  assert.match(
    appModuleSource,
    /AddManualBookingGuestName2026082400020,[\s\S]*AddDirectorSessionVersion2026091800010,/,
  );
});
