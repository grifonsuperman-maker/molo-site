const assert = require('node:assert/strict');
const test = require('node:test');

const {
  TelegramWebhookController,
} = require('../dist/telegram/telegram-webhook.controller.js');

const previousSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
process.env.TELEGRAM_WEBHOOK_SECRET = 'waiter-cleanup-secret';

test.after(() => {
  if (previousSecret === undefined) {
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
  } else {
    process.env.TELEGRAM_WEBHOOK_SECRET = previousSecret;
  }
});

function waiterCallback(data = 'waiter:calls') {
  return {
    callback_query: {
      id: 'callback-1',
      from: { id: 123 },
      data,
      message: {
        message_id: 77,
        chat: { id: 999 },
      },
    },
  };
}

function harness(result = { ok: true }, deleteError = null) {
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
      if (deleteError) throw deleteError;
      return { ok: true };
    },
  };

  return {
    controller: new TelegramWebhookController(service, telegram),
    calls,
  };
}

test('successful waiter callback removes the previous interactive block after handling', async () => {
  const { controller, calls } = harness();
  const update = waiterCallback('waiter:call:call-1');

  const result = await controller.handle(update, 'waiter-cleanup-secret');

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls.map((entry) => entry[0]), ['handle', 'delete']);
  assert.deepEqual(calls[1], ['delete', 999, 77]);
});

test('waiter menu navigation also removes the previous block', async () => {
  const { controller, calls } = harness();

  await controller.handle(
    waiterCallback('menu:waiter'),
    'waiter-cleanup-secret',
  );

  assert.deepEqual(calls.at(-1), ['delete', 999, 77]);
});

test('non-waiter callbacks keep their existing Telegram messages', async () => {
  const { controller, calls } = harness();

  await controller.handle(
    waiterCallback('booking:approve:booking-1'),
    'waiter-cleanup-secret',
  );

  assert.deepEqual(calls.map((entry) => entry[0]), ['handle']);
});

test('failed waiter callback keeps the source message so the user can retry', async () => {
  const { controller, calls } = harness({ ok: false });

  const result = await controller.handle(
    waiterCallback('waiter:calls'),
    'waiter-cleanup-secret',
  );

  assert.deepEqual(result, { ok: false });
  assert.deepEqual(calls.map((entry) => entry[0]), ['handle']);
});

test('Telegram cleanup failure never breaks an already successful waiter action', async () => {
  const { controller, calls } = harness(
    { ok: true },
    new Error('message cannot be deleted'),
  );

  const result = await controller.handle(
    waiterCallback('waiter:calls'),
    'waiter-cleanup-secret',
  );

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls.map((entry) => entry[0]), ['handle', 'delete']);
});
