require('reflect-metadata');

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const { UnauthorizedException } = require('@nestjs/common');

const {
  verifyTelegramInitData,
} = require('../dist/auth/telegram-init-data.js');
const {
  assertTelegramWebhookSecret,
} = require('../dist/telegram/telegram-webhook-secret.js');
const {
  TelegramWebhookService,
} = require('../dist/telegram/telegram-webhook.service.js');

function createInitData({ botToken, authDate, user }) {
  const params = new URLSearchParams({
    auth_date: String(authDate),
    query_id: 'test-query',
    user: JSON.stringify(user),
  });
  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secretKey = crypto
    .createHmac('sha256', 'WebAppData')
    .update(botToken)
    .digest();
  const hash = crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');
  params.set('hash', hash);
  return params.toString();
}

test('Telegram initData accepts a fresh correctly signed user', () => {
  const botToken = '123456:test-token';
  const initData = createInitData({
    botToken,
    authDate: 1_800_000_000,
    user: { id: 123, first_name: 'Олена', username: 'olena' },
  });

  const user = verifyTelegramInitData(initData, botToken, {
    nowSeconds: 1_800_000_100,
    maxAgeSeconds: 3600,
  });

  assert.deepEqual(user, {
    id: '123',
    firstName: 'Олена',
    lastName: undefined,
    username: 'olena',
  });
});

test('Telegram initData rejects a correctly signed but stale payload', () => {
  const botToken = '123456:test-token';
  const initData = createInitData({
    botToken,
    authDate: 1_800_000_000,
    user: { id: 123 },
  });

  assert.throws(
    () =>
      verifyTelegramInitData(initData, botToken, {
        nowSeconds: 1_800_004_000,
        maxAgeSeconds: 3600,
      }),
    /застарів/,
  );
});

test('Telegram webhook secret is checked after it is configured', () => {
  assert.doesNotThrow(() =>
    assertTelegramWebhookSecret('secret-123', 'secret-123'),
  );
  assert.throws(
    () => assertTelegramWebhookSecret('wrong', 'secret-123'),
    UnauthorizedException,
  );
  assert.doesNotThrow(() => assertTelegramWebhookSecret(undefined, undefined));
});

test('/start includes a Telegram Mini App button when its URL is configured', async () => {
  const previousUrl = process.env.TELEGRAM_WEB_APP_URL;
  process.env.TELEGRAM_WEB_APP_URL = 'https://molo.example/app';
  const sent = [];
  const telegram = {
    async sendMessage(...args) {
      sent.push(args);
      return { ok: true };
    },
    async answerCallbackQuery() {
      return { ok: true };
    },
  };
  const service = new TelegramWebhookService({}, {}, {}, telegram);

  try {
    await service.handleMessage({ chat: { id: 42 }, text: '/start' });
  } finally {
    if (previousUrl === undefined) delete process.env.TELEGRAM_WEB_APP_URL;
    else process.env.TELEGRAM_WEB_APP_URL = previousUrl;
  }

  assert.equal(sent.length, 1);
  const keyboard = sent[0][2].inline_keyboard;
  assert.deepEqual(keyboard[0], [
    {
      text: '🍽 Відкрити застосунок MOLO',
      web_app: { url: 'https://molo.example/app#guest' },
    },
  ]);
});

test('bot acknowledges callback queries before handling their action', async () => {
  const calls = [];
  const telegram = {
    async answerCallbackQuery(id) {
      calls.push(['answer', id]);
      return { ok: true };
    },
    async sendMessage(chatId, text) {
      calls.push(['message', chatId, text]);
      return { ok: true };
    },
  };
  const service = new TelegramWebhookService({}, {}, {}, telegram);

  await service.handleCallback({
    id: 'callback-1',
    message: { chat: { id: 42 } },
    data: 'unknown:action',
  });

  assert.deepEqual(calls[0], ['answer', 'callback-1']);
  assert.match(calls[1][2], /не розпізнано/);
});
