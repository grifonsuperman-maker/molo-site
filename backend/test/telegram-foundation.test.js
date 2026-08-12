require('reflect-metadata');

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const { UnauthorizedException } = require('@nestjs/common');
const { hash } = require('bcryptjs');

const {
  verifyTelegramInitData,
} = require('../dist/auth/telegram-init-data.js');
const {
  assertTelegramWebhookSecret,
} = require('../dist/telegram/telegram-webhook-secret.js');
const {
  TelegramWebhookService,
} = require('../dist/telegram/telegram-webhook.service.js');
const {
  TelegramService,
} = require('../dist/notifications/telegram.service.js');
const {
  TelegramStaffLinkService,
} = require('../dist/staff/telegram-staff-link.service.js');

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
  const hashValue = crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');
  params.set('hash', hashValue);
  return params.toString();
}

function createSingleStaffRepository(staff, lockCalls, transactionState) {
  const repo = {
    async findOne({ where }) {
      if (where.id) return where.id === staff.id ? staff : null;
      if (Object.prototype.hasOwnProperty.call(where, 'telegramInviteTokenHash')) {
        return staff.telegramInviteTokenHash === where.telegramInviteTokenHash
          ? staff
          : null;
      }
      if (Object.prototype.hasOwnProperty.call(where, 'telegramId')) {
        return staff.telegramId === where.telegramId ? staff : null;
      }
      return null;
    },
    async save(value) {
      return value;
    },
    createQueryBuilder() {
      let expectedStaffId = null;
      let expectedHash = null;
      return {
        setLock(value) {
          lockCalls.push(value);
          return this;
        },
        where(_sql, params) {
          if (params.staffId !== undefined) expectedStaffId = params.staffId;
          if (params.tokenHash !== undefined) expectedHash = params.tokenHash;
          return this;
        },
        async getOne() {
          if (expectedStaffId !== null) {
            return staff.id === expectedStaffId ? staff : null;
          }
          return staff.telegramInviteTokenHash === expectedHash ? staff : null;
        },
      };
    },
  };

  const manager = {
    getRepository() {
      return repo;
    },
  };

  repo.manager = {
    async transaction(callback) {
      transactionState.count += 1;
      return callback(manager);
    },
  };

  return repo;
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

test('Telegram webhook registration uses Render URL and webhook secret', async () => {
  const previousToken = process.env.TELEGRAM_BOT_TOKEN;
  const previousUrl = process.env.RENDER_EXTERNAL_URL;
  const previousSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const previousFetch = global.fetch;
  const calls = [];

  process.env.TELEGRAM_BOT_TOKEN = '123456:test-token';
  process.env.RENDER_EXTERNAL_URL = 'https://molo-backend.example';
  process.env.TELEGRAM_WEBHOOK_SECRET = 'secret_123';
  global.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return {
      ok: true,
      json: async () => ({ ok: true, result: true }),
    };
  };

  try {
    const service = new TelegramService();
    const result = await service.registerWebhook();

    assert.deepEqual(result, {
      configured: true,
      webhookUrl: 'https://molo-backend.example/api/telegram/webhook',
    });
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].url,
      'https://api.telegram.org/bot123456:test-token/setWebhook',
    );
    assert.deepEqual(JSON.parse(calls[0].options.body), {
      url: 'https://molo-backend.example/api/telegram/webhook',
      secret_token: 'secret_123',
      allowed_updates: ['message', 'callback_query'],
    });
  } finally {
    if (previousToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = previousToken;
    if (previousUrl === undefined) delete process.env.RENDER_EXTERNAL_URL;
    else process.env.RENDER_EXTERNAL_URL = previousUrl;
    if (previousSecret === undefined) delete process.env.TELEGRAM_WEBHOOK_SECRET;
    else process.env.TELEGRAM_WEBHOOK_SECRET = previousSecret;
    global.fetch = previousFetch;
  }
});

test('/start shows guests only the MOLO Mini App button', async () => {
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
  const telegramStaff = {
    async findActiveStaffByTelegramId() {
      return null;
    },
  };
  const service = new TelegramWebhookService(
    {},
    {},
    {},
    telegram,
    telegramStaff,
  );

  try {
    await service.handleMessage({
      chat: { id: 42 },
      from: { id: 777 },
      text: '/start',
    });
  } finally {
    if (previousUrl === undefined) delete process.env.TELEGRAM_WEB_APP_URL;
    else process.env.TELEGRAM_WEB_APP_URL = previousUrl;
  }

  assert.equal(sent.length, 1);
  const keyboard = sent[0][2].inline_keyboard;
  assert.equal(keyboard.length, 1);
  assert.deepEqual(keyboard[0], [
    {
      text: '🍽 Відкрити застосунок MOLO',
      web_app: { url: 'https://molo.example/app#guest' },
    },
  ]);
});

test('/start shows a linked hookah worker only the hookah panel', async () => {
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
  const telegramStaff = {
    async findActiveStaffByTelegramId(telegramId) {
      assert.equal(telegramId, '777');
      return { fullName: 'Іван', role: 'hookah' };
    },
  };
  const service = new TelegramWebhookService(
    {},
    {},
    {},
    telegram,
    telegramStaff,
  );

  try {
    await service.handleMessage({
      chat: { id: 42 },
      from: { id: 777 },
      text: '/start',
    });
  } finally {
    if (previousUrl === undefined) delete process.env.TELEGRAM_WEB_APP_URL;
    else process.env.TELEGRAM_WEB_APP_URL = previousUrl;
  }

  const keyboard = sent[0][2].inline_keyboard;
  assert.equal(keyboard.length, 1);
  assert.deepEqual(keyboard[0], [
    {
      text: '💨 Відкрити панель кальянника',
      web_app: { url: 'https://molo.example/app#hookah' },
    },
  ]);
});

test('/start uses the director panel label without a crown', async () => {
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
  const telegramStaff = {
    async findActiveStaffByTelegramId() {
      return { fullName: 'Директор', role: 'owner' };
    },
  };
  const service = new TelegramWebhookService(
    {},
    {},
    {},
    telegram,
    telegramStaff,
  );

  try {
    await service.handleMessage({
      chat: { id: 42 },
      from: { id: 888 },
      text: '/start',
    });
  } finally {
    if (previousUrl === undefined) delete process.env.TELEGRAM_WEB_APP_URL;
    else process.env.TELEGRAM_WEB_APP_URL = previousUrl;
  }

  assert.deepEqual(sent[0][2].inline_keyboard[0], [
    {
      text: '📊 Відкрити панель директора',
      web_app: { url: 'https://molo.example/app#director' },
    },
  ]);
});

test('staff Telegram invite creation and consumption both lock the staff row', async () => {
  const previousToken = process.env.TELEGRAM_BOT_TOKEN;
  process.env.TELEGRAM_BOT_TOKEN = '123456:test-token';
  const lockCalls = [];
  const transactionState = { count: 0 };

  const staff = {
    id: '11111111-1111-4111-8111-111111111111',
    fullName: 'Олег Офіціант',
    role: 'waiter',
    active: true,
    isArchived: false,
    telegramId: null,
    telegramInviteTokenHash: null,
    telegramInviteExpiresAt: null,
    pinHash: await hash('1234', 4),
    directorPasswordHash: null,
  };

  const repo = createSingleStaffRepository(
    staff,
    lockCalls,
    transactionState,
  );
  const jwt = {
    async signAsync(payload) {
      assert.equal(payload.telegramId, '777');
      return 'linked-jwt';
    },
  };
  const telegram = {
    async getBotUsername() {
      return 'molo_restaurant_bot';
    },
  };
  const service = new TelegramStaffLinkService(repo, jwt, telegram);

  try {
    const before = Date.now();
    const invite = await service.createInvite(staff.id);
    const expiryMs = new Date(invite.expiresAt).getTime() - before;
    assert.ok(expiryMs > 29 * 60 * 1000);
    assert.ok(expiryMs <= 30 * 60 * 1000 + 1000);
    assert.equal(transactionState.count, 1);
    assert.deepEqual(lockCalls, ['pessimistic_write']);

    const startParam = new URL(invite.inviteUrl).searchParams.get('startapp');
    assert.match(startParam, /^staff_[A-Za-z0-9_-]+$/);

    const info = await service.getInviteInfo(startParam);
    assert.deepEqual(
      { fullName: info.fullName, role: info.role, authType: info.authType },
      { fullName: 'Олег Офіціант', role: 'waiter', authType: 'pin' },
    );

    const initData = createInitData({
      botToken: '123456:test-token',
      authDate: Math.floor(Date.now() / 1000),
      user: { id: 777, first_name: 'Олег' },
    });
    const linked = await service.confirmInvite({
      token: startParam,
      initData,
      pin: '1234',
    });

    assert.equal(linked.accessToken, 'linked-jwt');
    assert.equal(linked.user.role, 'waiter');
    assert.equal(staff.telegramId, '777');
    assert.equal(staff.telegramInviteTokenHash, null);
    assert.equal(staff.telegramInviteExpiresAt, null);
    assert.equal(transactionState.count, 2);
    assert.deepEqual(lockCalls, ['pessimistic_write', 'pessimistic_write']);

    await assert.rejects(
      () => service.getInviteInfo(startParam),
      /вже використане|недійсне/,
    );
  } finally {
    if (previousToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = previousToken;
  }
});

test('director Telegram invite enforces the existing five-attempt lockout state', async () => {
  const previousToken = process.env.TELEGRAM_BOT_TOKEN;
  process.env.TELEGRAM_BOT_TOKEN = '123456:test-token';
  const lockCalls = [];
  const transactionState = { count: 0 };

  const director = {
    id: '22222222-2222-4222-8222-222222222222',
    fullName: 'Директор',
    role: 'owner',
    active: true,
    isArchived: false,
    telegramId: null,
    telegramInviteTokenHash: null,
    telegramInviteExpiresAt: null,
    pinHash: null,
    directorPasswordHash: await hash('correct-password', 4),
    directorFailedLoginAttempts: 0,
    directorLockedUntil: null,
  };

  const repo = createSingleStaffRepository(
    director,
    lockCalls,
    transactionState,
  );
  const telegram = {
    async getBotUsername() {
      return 'molo_restaurant_bot';
    },
  };
  const service = new TelegramStaffLinkService(repo, { signAsync() {} }, telegram);

  try {
    const invite = await service.createInvite(director.id);
    const startParam = new URL(invite.inviteUrl).searchParams.get('startapp');
    const initData = createInitData({
      botToken: '123456:test-token',
      authDate: Math.floor(Date.now() / 1000),
      user: { id: 888, first_name: 'Director' },
    });

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      await assert.rejects(
        () =>
          service.confirmInvite({
            token: startParam,
            initData,
            password: 'wrong-password',
          }),
        new RegExp(`Залишилось спроб: ${5 - attempt}`),
      );
    }

    await assert.rejects(
      () =>
        service.confirmInvite({
          token: startParam,
          initData,
          password: 'wrong-password',
        }),
      /заблоковано на 15 хв/,
    );

    assert.equal(director.directorFailedLoginAttempts, 5);
    assert.ok(new Date(director.directorLockedUntil).getTime() > Date.now());
    assert.equal(director.telegramId, null);

    await assert.rejects(
      () =>
        service.confirmInvite({
          token: startParam,
          initData,
          password: 'correct-password',
        }),
      /Повторіть через/,
    );
    assert.equal(director.telegramId, null);
  } finally {
    if (previousToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = previousToken;
  }
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
  const telegramStaff = {
    async findActiveStaffByTelegramId() {
      return null;
    },
  };
  const service = new TelegramWebhookService(
    {},
    {},
    {},
    telegram,
    telegramStaff,
  );

  await service.handleCallback({
    id: 'callback-1',
    message: { chat: { id: 42 } },
    data: 'unknown:action',
  });

  assert.deepEqual(calls[0], ['answer', 'callback-1']);
  assert.match(calls[1][2], /не розпізнано/);
});
