const assert = require('node:assert/strict');
const test = require('node:test');

const {
  TelegramWebhookController,
} = require('../dist/telegram/telegram-webhook.controller.js');

const previousSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
process.env.TELEGRAM_WEBHOOK_SECRET = 'hookah-cleanup-secret';

test.after(() => {
  if (previousSecret === undefined) {
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
  } else {
    process.env.TELEGRAM_WEBHOOK_SECRET = previousSecret;
  }
});

function hookahCallback(data = 'hookah:calls') {
  return {
    callback_query: {
      id: 'callback-hookah',
      from: { id: 777 },
      data,
      message: {
        message_id: 88,
        chat: { id: 999 },
      },
    },
  };
}

function harness(result = { ok: true }) {
  const calls = [];
  const service = {
    async handleUpdate(update) {
      calls.push(['handle', update]);
      return result;
    },
  };
  const telegram = {
    async deleteMessage(chatId, messageId) {
      calls.push(['delete', chatId, messageId]);
      return { ok: true };
    },
  };

  return {
    controller: new TelegramWebhookController(service, telegram),
    calls,
  };
}

test('successful hookah callback removes the previous interactive block', async () => {
  const { controller, calls } = harness();

  const result = await controller.handle(
    hookahCallback('hookah:accept_10:call-1'),
    'hookah-cleanup-secret',
  );

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls.map((entry) => entry[0]), ['handle', 'delete']);
  assert.deepEqual(calls[1], ['delete', 999, 88]);
});

test('hookah menu navigation also removes the previous block', async () => {
  const { controller, calls } = harness();

  await controller.handle(
    hookahCallback('menu:hookah'),
    'hookah-cleanup-secret',
  );

  assert.deepEqual(calls.at(-1), ['delete', 999, 88]);
});

test('failed hookah callback keeps the source block so the worker can retry', async () => {
  const { controller, calls } = harness({ ok: false });

  const result = await controller.handle(
    hookahCallback('hookah:calls'),
    'hookah-cleanup-secret',
  );

  assert.deepEqual(result, { ok: false });
  assert.deepEqual(calls.map((entry) => entry[0]), ['handle']);
});
