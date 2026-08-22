require('reflect-metadata');

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  TelegramWebhookService,
} = require('../dist/telegram/telegram-webhook.service.js');

async function startAsWaiter(isOnShift) {
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
      return {
        id: 'waiter-1',
        fullName: 'Олег Офіціант',
        role: 'waiter',
        isOnShift,
      };
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

  return sent[0][2].inline_keyboard;
}

test('/start hides waiter command menu outside an active shift', async () => {
  const keyboard = await startAsWaiter(false);

  assert.equal(keyboard.length, 1);
  assert.deepEqual(keyboard[0], [
    {
      text: '👨‍🍳 Відкрити панель офіціанта',
      web_app: { url: 'https://molo.example/app#waiter' },
    },
  ]);
});

test('/start keeps waiter command menu during an active shift', async () => {
  const keyboard = await startAsWaiter(true);

  assert.equal(keyboard.length, 2);
  assert.deepEqual(keyboard[0], [
    {
      text: '👨‍🍳 Команди Офіціанта',
      callback_data: 'menu:waiter',
    },
  ]);
  assert.deepEqual(keyboard[1], [
    {
      text: '👨‍🍳 Відкрити панель офіціанта',
      web_app: { url: 'https://molo.example/app#waiter' },
    },
  ]);
});
