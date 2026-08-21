require('reflect-metadata');

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  TelegramHookahMenuService,
} = require('../dist/telegram/telegram-hookah-menu.service.js');
const {
  TelegramWebhookService,
} = require('../dist/telegram/telegram-webhook.service.js');

function callback(data, fromId = 777) {
  return {
    id: 'callback-hookah',
    from: { id: fromId },
    message: { chat: { id: 42 } },
    data,
  };
}

test('hookah Telegram menu shows synchronized new and personal call counts', async () => {
  const sent = [];
  const hookahCalls = {
    async listActive() {
      return [
        { id: 'new-1', status: 'new' },
        { id: 'new-2', status: 'new' },
        { id: 'accepted-other', status: 'accepted' },
      ];
    },
    async listMine(staffId) {
      assert.equal(staffId, 'hookah-1');
      return [{ id: 'mine-1', status: 'accepted' }];
    },
    async availability() {
      return { available: true };
    },
  };
  const telegram = {
    async sendMessage(...args) {
      sent.push(args);
      return { ok: true };
    },
  };
  const menu = new TelegramHookahMenuService(hookahCalls, telegram);

  await menu.sendMenu(42, 'hookah-1', 'https://molo.example/app#hookah');

  const keyboard = sent[0][2].inline_keyboard;
  assert.equal(keyboard[0][0].text, '🔔 Нові виклики · 2');
  assert.equal(keyboard[0][1].text, '✅ Мої виклики · 1');
  assert.equal(keyboard[1][0].callback_data, 'hookah:availability_off');
  assert.deepEqual(keyboard[2], [
    {
      text: '📱 Відкрити повний пульт',
      web_app: { url: 'https://molo.example/app#hookah' },
    },
  ]);
});

test('hookah Telegram acceptance uses the same HookahCallsService state as Mini App', async () => {
  const calls = [];
  const hookahCalls = {
    async accept(id, staffId, dto) {
      calls.push(['accept', id, staffId, dto]);
      return { message: 'Виклик прийнято' };
    },
    async listMine(staffId) {
      calls.push(['mine', staffId]);
      return [
        {
          id: 'call-1',
          tableNumber: '8',
          etaMinutes: 10,
          status: 'accepted',
        },
      ];
    },
  };
  const telegram = {
    async sendMessage() {
      return { ok: true };
    },
  };
  const menu = new TelegramHookahMenuService(hookahCalls, telegram);

  const handled = await menu.handle(
    'accept_10',
    'call-1',
    42,
    { role: 'hookah', staffId: 'hookah-1', sub: 'hookah-1' },
  );

  assert.equal(handled, true);
  assert.deepEqual(calls[0], [
    'accept',
    'call-1',
    'hookah-1',
    { etaMinutes: 10 },
  ]);
  assert.deepEqual(calls[1], ['mine', 'hookah-1']);
});

test('hookah callbacks require the linked hookah role and active shift', async () => {
  const menuCalls = [];
  const telegram = {
    async answerCallbackQuery() {
      return { ok: true };
    },
    async sendMessage() {
      return { ok: true };
    },
  };
  const hookahMenu = {
    async handle(...args) {
      menuCalls.push(args);
      return true;
    },
  };
  const telegramStaff = {
    async findActiveStaffByTelegramId(telegramId) {
      assert.equal(telegramId, '777');
      return {
        id: 'hookah-1',
        fullName: 'Іван',
        role: 'hookah',
        active: true,
        isArchived: false,
        isOnShift: true,
      };
    },
  };
  const service = new TelegramWebhookService(
    {},
    {},
    {},
    telegram,
    telegramStaff,
    undefined,
    hookahMenu,
  );

  assert.deepEqual(
    await service.handleCallback(callback('hookah:accept_10:call-1')),
    { ok: true },
  );
  assert.equal(menuCalls.length, 1);
  assert.equal(menuCalls[0][0], 'accept_10');
  assert.equal(menuCalls[0][1], 'call-1');
  assert.equal(menuCalls[0][3].role, 'hookah');
  assert.equal(menuCalls[0][3].staffId, 'hookah-1');
});

test('/start exposes hookah commands when the Telegram hookah console is connected', async () => {
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
      return {
        id: 'hookah-1',
        fullName: 'Іван',
        role: 'hookah',
        isOnShift: true,
      };
    },
  };
  const service = new TelegramWebhookService(
    {},
    {},
    {},
    telegram,
    telegramStaff,
    undefined,
    {},
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

  assert.deepEqual(sent[0][2].inline_keyboard, [
    [
      {
        text: '💨 Команди Кальянника',
        callback_data: 'menu:hookah',
      },
    ],
    [
      {
        text: '💨 Відкрити панель кальянника',
        web_app: { url: 'https://molo.example/app#hookah' },
      },
    ],
  ]);
});
