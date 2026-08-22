const assert = require('node:assert/strict');
const test = require('node:test');

const {
  TelegramWebhookService,
} = require('../dist/telegram/telegram-webhook.service.js');
const {
  TelegramWebhookController,
} = require('../dist/telegram/telegram-webhook.controller.js');

function directorStaff() {
  return {
    id: 'director-1',
    fullName: 'Директор',
    role: 'owner',
    active: true,
    isArchived: false,
    isOnShift: false,
  };
}

function adminStaff() {
  return {
    id: 'admin-1',
    fullName: 'Адміністратор',
    role: 'admin',
    active: true,
    isArchived: false,
    isOnShift: false,
  };
}

test('/start gives a linked Director a Director commands button and keeps the full Director Mini App button', async () => {
  const previousUrl = process.env.TELEGRAM_WEB_APP_URL;
  process.env.TELEGRAM_WEB_APP_URL = 'https://molo.example/app';
  const sent = [];
  const telegram = {
    async sendMessage(...args) { sent.push(args); return { ok: true }; },
    async answerCallbackQuery() { return { ok: true }; },
  };
  const telegramStaff = {
    async findActiveStaffByTelegramId(id) {
      assert.equal(id, '999');
      return directorStaff();
    },
  };
  const directorMenu = {
    clearPendingInput() {},
    hasPendingInput() { return false; },
  };
  const service = new TelegramWebhookService(
    {}, {}, {}, telegram, telegramStaff,
    undefined, undefined, undefined, directorMenu,
  );

  try {
    await service.handleMessage({ chat: { id: 42 }, from: { id: 999 }, text: '/start' });
  } finally {
    if (previousUrl === undefined) delete process.env.TELEGRAM_WEB_APP_URL;
    else process.env.TELEGRAM_WEB_APP_URL = previousUrl;
  }

  const buttons = sent[0][2].inline_keyboard.flat();
  assert.deepEqual(buttons, [
    { text: '📊 Команди Директора', callback_data: 'menu:director' },
    { text: '📊 Відкрити панель директора', web_app: { url: 'https://molo.example/app#director' } },
  ]);
  assert.equal(buttons.some((button) => button.callback_data === 'menu:admin'), false);
});

test('Director callbacks are authorized only for owner and delegated to Director menu', async () => {
  const calls = [];
  let currentStaff = directorStaff();
  const telegram = {
    async sendMessage(...args) { calls.push(['message', ...args]); return { ok: true }; },
    async answerCallbackQuery() { return { ok: true }; },
  };
  const telegramStaff = {
    async findActiveStaffByTelegramId() { return currentStaff; },
  };
  const directorMenu = {
    async handle(action, id, chatId, actor, appUrl) {
      calls.push(['director', action, id, chatId, actor.role, appUrl]);
      return true;
    },
  };
  const service = new TelegramWebhookService(
    {}, {}, {}, telegram, telegramStaff,
    undefined, undefined, undefined, directorMenu,
  );

  const allowed = await service.handleCallback({
    id: 'cb-1', from: { id: 999 }, data: 'director:stats', message: { chat: { id: 42 } },
  });
  assert.equal(allowed.ok, true);
  assert.equal(calls.some((entry) => entry[0] === 'director' && entry[1] === 'stats'), true);

  currentStaff = adminStaff();
  const denied = await service.handleCallback({
    id: 'cb-2', from: { id: 777 }, data: 'director:stats', message: { chat: { id: 42 } },
  });
  assert.equal(denied.ok, false);
  assert.equal(calls.filter((entry) => entry[0] === 'director').length, 1);
});

test('menu:director opens only the Director menu for owner', async () => {
  const calls = [];
  const telegram = {
    async sendMessage() { return { ok: true }; },
    async answerCallbackQuery() { return { ok: true }; },
  };
  const telegramStaff = {
    async findActiveStaffByTelegramId() { return directorStaff(); },
  };
  const directorMenu = {
    async sendMenu(chatId, actor, appUrl) {
      calls.push([chatId, actor.role, appUrl]);
    },
  };
  const previousUrl = process.env.TELEGRAM_WEB_APP_URL;
  process.env.TELEGRAM_WEB_APP_URL = 'https://molo.example/app';
  const service = new TelegramWebhookService(
    {}, {}, {}, telegram, telegramStaff,
    undefined, undefined, undefined, directorMenu,
  );

  try {
    const result = await service.handleCallback({
      id: 'cb-menu', from: { id: 999 }, data: 'menu:director', message: { chat: { id: 42 } },
    });
    assert.equal(result.ok, true);
  } finally {
    if (previousUrl === undefined) delete process.env.TELEGRAM_WEB_APP_URL;
    else process.env.TELEGRAM_WEB_APP_URL = previousUrl;
  }

  assert.deepEqual(calls, [[42, 'owner', 'https://molo.example/app#director']]);
});

test('Director broadcast text input is accepted only from linked owner', async () => {
  let currentStaff = directorStaff();
  const calls = [];
  const telegram = {
    async sendMessage() { return { ok: true }; },
    async answerCallbackQuery() { return { ok: true }; },
  };
  const telegramStaff = {
    async findActiveStaffByTelegramId() { return currentStaff; },
  };
  const directorMenu = {
    hasPendingInput() { return true; },
    async handleText(text, chatId, actor) {
      calls.push([text, chatId, actor.role]);
      return true;
    },
  };
  const service = new TelegramWebhookService(
    {}, {}, {}, telegram, telegramStaff,
    undefined, undefined, undefined, directorMenu,
  );

  const ownerResult = await service.handleMessage({ chat: { id: 42 }, from: { id: 999 }, text: 'Текст' });
  assert.equal(ownerResult.ok, true);
  assert.deepEqual(calls, [['Текст', 42, 'owner']]);

  currentStaff = adminStaff();
  await service.handleMessage({ chat: { id: 42 }, from: { id: 777 }, text: 'Чужий текст' });
  assert.equal(calls.length, 1);
});

test('successful Director step deletes the previous Director block but legacy booking pushes stay untouched', async () => {
  const deleted = [];
  const telegram = {
    async deleteMessage(chatId, messageId) { deleted.push([chatId, messageId]); },
  };
  const service = {
    async handleUpdate() { return { ok: true }; },
  };
  const controller = new TelegramWebhookController(service, telegram);

  await controller.handle({
    callback_query: {
      data: 'director:stats',
      message: { chat: { id: 42 }, message_id: 100 },
    },
  });
  await controller.handle({
    callback_query: {
      data: 'booking:approve:booking-1',
      message: { chat: { id: 42 }, message_id: 101 },
    },
  });

  assert.deepEqual(deleted, [[42, 100]]);
});
