const assert = require('node:assert/strict');
const test = require('node:test');

const {
  TelegramWebhookController,
} = require('../dist/telegram/telegram-webhook.controller.js');

const previousSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
process.env.TELEGRAM_WEBHOOK_SECRET = 'admin-cleanup-secret';

test.after(() => {
  if (previousSecret === undefined) delete process.env.TELEGRAM_WEBHOOK_SECRET;
  else process.env.TELEGRAM_WEBHOOK_SECRET = previousSecret;
});

function update(data) {
  return {
    callback_query: {
      id: 'callback-admin',
      from: { id: 777 },
      data,
      message: {
        message_id: 88,
        chat: { id: 42 },
      },
    },
  };
}

function harness(result = { ok: true }) {
  const calls = [];
  const service = {
    async handleUpdate(value) {
      calls.push(['handle', value]);
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
    calls,
    controller: new TelegramWebhookController(service, telegram),
  };
}

test('successful Admin panel callback removes the previous interactive block', async () => {
  const { controller, calls } = harness();

  const result = await controller.handle(
    update('admin:locations'),
    'admin-cleanup-secret',
  );

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls.map((entry) => entry[0]), ['handle', 'delete']);
  assert.deepEqual(calls[1], ['delete', 42, 88]);
});

test('Admin menu navigation also removes the previous block', async () => {
  const { controller, calls } = harness();

  await controller.handle(update('menu:admin'), 'admin-cleanup-secret');

  assert.deepEqual(calls.at(-1), ['delete', 42, 88]);
});

test('legacy booking notifications are not added to Admin step cleanup', async () => {
  const { controller, calls } = harness();

  await controller.handle(
    update('booking:approve:booking-1'),
    'admin-cleanup-secret',
  );

  assert.deepEqual(calls.map((entry) => entry[0]), ['handle']);
});

test('failed Admin callback keeps the source block for retry', async () => {
  const { controller, calls } = harness({ ok: false });

  const result = await controller.handle(
    update('admin:broadcast'),
    'admin-cleanup-secret',
  );

  assert.deepEqual(result, { ok: false });
  assert.deepEqual(calls.map((entry) => entry[0]), ['handle']);
});
