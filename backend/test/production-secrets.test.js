const assert = require('node:assert/strict');
const test = require('node:test');

const {
  assertProductionSecrets,
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
