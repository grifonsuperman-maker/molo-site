const assert = require('node:assert/strict');
const test = require('node:test');

const { AuthService } = require('../dist/auth/auth.service.js');
const {
  assertProductionSecrets,
  isDevAuthAllowed,
  isProductionRuntime,
  resolveJwtSecret,
} = require('../dist/config/runtime-secrets.js');
const {
  assertTelegramWebhookSecret,
} = require('../dist/telegram/telegram-webhook-secret.js');

test('local development keeps the existing JWT fallback', () => {
  const env = { NODE_ENV: 'development' };

  assert.equal(isProductionRuntime(env), false);
  assert.equal(resolveJwtSecret(env), 'dev-secret-change-me');
  assert.doesNotThrow(() => assertProductionSecrets(env));
});

test('Render is treated as production even without NODE_ENV', () => {
  const env = { RENDER_EXTERNAL_URL: 'https://molo-backend.example' };

  assert.equal(isProductionRuntime(env), true);
  assert.throws(
    () => resolveJwtSecret(env),
    /JWT_SECRET is required in production/,
  );
  assert.throws(
    () => assertProductionSecrets(env),
    /JWT_SECRET, TELEGRAM_WEBHOOK_SECRET/,
  );
});

test('production startup accepts configured JWT and Telegram webhook secrets', () => {
  const env = {
    NODE_ENV: 'production',
    JWT_SECRET: 'jwt-secret',
    TELEGRAM_WEBHOOK_SECRET: 'telegram-secret',
  };

  assert.equal(resolveJwtSecret(env), 'jwt-secret');
  assert.doesNotThrow(() => assertProductionSecrets(env));
});

test('development Telegram dev auth requires an explicit development runtime and flag', () => {
  assert.equal(
    isDevAuthAllowed({ NODE_ENV: 'development', ALLOW_DEV_AUTH: 'true' }),
    true,
  );
  assert.equal(
    isDevAuthAllowed({ NODE_ENV: 'development', ALLOW_DEV_AUTH: 'false' }),
    false,
  );
  assert.equal(
    isDevAuthAllowed({ ALLOW_DEV_AUTH: 'true' }),
    false,
  );
});

test('production and Render always disable Telegram dev auth', () => {
  assert.equal(
    isDevAuthAllowed({ NODE_ENV: 'production', ALLOW_DEV_AUTH: 'true' }),
    false,
  );
  assert.equal(
    isDevAuthAllowed({
      NODE_ENV: 'development',
      RENDER_EXTERNAL_URL: 'https://molo-backend.example',
      ALLOW_DEV_AUTH: 'true',
    }),
    false,
  );
});

test('AuthService allows devTelegramId only in explicit development runtime', async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousRenderExternalUrl = process.env.RENDER_EXTERNAL_URL;
  const previousAllowDevAuth = process.env.ALLOW_DEV_AUTH;

  process.env.NODE_ENV = 'development';
  delete process.env.RENDER_EXTERNAL_URL;
  process.env.ALLOW_DEV_AUTH = 'true';

  const staffRepo = {
    findOne: async () => null,
  };
  const jwtService = {
    signAsync: async (payload) => {
      assert.equal(payload.telegramId, '123456');
      assert.equal(payload.role, 'guest');
      return 'dev-token';
    },
  };

  try {
    const service = new AuthService(staffRepo, jwtService);
    const result = await service.authenticateTelegram({
      devTelegramId: '123456',
      devName: 'Local Dev',
    });

    assert.equal(result.accessToken, 'dev-token');
    assert.equal(result.user.telegramId, '123456');
    assert.equal(result.user.name, 'Local Dev');
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

test('AuthService rejects devTelegramId when runtime is not explicitly development', async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousRenderExternalUrl = process.env.RENDER_EXTERNAL_URL;
  const previousAllowDevAuth = process.env.ALLOW_DEV_AUTH;

  delete process.env.NODE_ENV;
  delete process.env.RENDER_EXTERNAL_URL;
  process.env.ALLOW_DEV_AUTH = 'true';

  const staffRepo = {
    findOne: async () => {
      throw new Error('staff lookup must not run for rejected dev auth');
    },
  };
  const jwtService = {
    signAsync: async () => {
      throw new Error('token signing must not run for rejected dev auth');
    },
  };

  try {
    const service = new AuthService(staffRepo, jwtService);
    await assert.rejects(
      () => service.authenticateTelegram({ devTelegramId: '123456' }),
      /initData Telegram відсутній/,
    );
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

test('AuthService rejects devTelegramId on Render even when ALLOW_DEV_AUTH is true', async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousRenderExternalUrl = process.env.RENDER_EXTERNAL_URL;
  const previousAllowDevAuth = process.env.ALLOW_DEV_AUTH;

  delete process.env.NODE_ENV;
  process.env.RENDER_EXTERNAL_URL = 'https://molo-backend.example';
  process.env.ALLOW_DEV_AUTH = 'true';

  const staffRepo = {
    findOne: async () => {
      throw new Error('staff lookup must not run for rejected dev auth');
    },
  };
  const jwtService = {
    signAsync: async () => {
      throw new Error('token signing must not run for rejected dev auth');
    },
  };

  try {
    const service = new AuthService(staffRepo, jwtService);
    await assert.rejects(
      () => service.authenticateTelegram({ devTelegramId: '123456' }),
      /initData Telegram відсутній/,
    );
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

test('JWT verification uses the same resolved secret as token signing', async () => {
  const previousJwtSecret = process.env.JWT_SECRET;
  const previousNodeEnv = process.env.NODE_ENV;

  process.env.JWT_SECRET = '  jwt-secret  ';
  process.env.NODE_ENV = 'production';

  const jwtService = {
    verifyAsync: async (_token, options) => {
      assert.equal(options.secret, 'jwt-secret');
      return {
        sub: 'guest',
        telegramId: '1',
        staffId: null,
        role: 'guest',
        name: null,
      };
    },
  };
  const staffRepo = {
    findOne: async () => {
      throw new Error('staff lookup must not run for a guest token');
    },
  };

  try {
    const service = new AuthService(staffRepo, jwtService);
    const payload = await service.verifyToken('guest-token');
    assert.equal(payload.role, 'guest');
  } finally {
    if (previousJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousJwtSecret;

    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
});

test('Telegram webhook remains permissive without a configured secret only outside production', () => {
  assert.doesNotThrow(() =>
    assertTelegramWebhookSecret(undefined, undefined, { NODE_ENV: 'development' }),
  );

  assert.throws(
    () =>
      assertTelegramWebhookSecret(undefined, undefined, {
        RENDER_EXTERNAL_URL: 'https://molo-backend.example',
      }),
    /Секрет Telegram webhook не налаштований/,
  );
});

test('Telegram webhook requires the configured secret to match', () => {
  const env = { NODE_ENV: 'production' };

  assert.doesNotThrow(() =>
    assertTelegramWebhookSecret('correct-secret', 'correct-secret', env),
  );
  assert.throws(
    () => assertTelegramWebhookSecret(undefined, 'correct-secret', env),
    /Секрет Telegram webhook відсутній/,
  );
  assert.throws(
    () => assertTelegramWebhookSecret('wrong-secret', 'correct-secret', env),
    /Секрет Telegram webhook невірний/,
  );
});
