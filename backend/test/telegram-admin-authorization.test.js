const assert = require('node:assert/strict');
const test = require('node:test');

const {
  TelegramWebhookService,
} = require('../dist/telegram/telegram-webhook.service.js');

function callback(data, fromId = 777) {
  return {
    id: 'callback-admin',
    from: { id: fromId },
    message: { chat: { id: 42 } },
    data,
  };
}

function harness(actor) {
  const calls = [];
  const telegram = {
    async answerCallbackQuery() {
      return { ok: true };
    },
    async sendMessage(_chatId, text) {
      calls.push(['message', text]);
      return { ok: true };
    },
  };
  const telegramStaff = {
    async findActiveStaffByTelegramId(id) {
      calls.push(['staff-find', id]);
      return actor;
    },
  };
  const adminMenu = {
    async handle(action, id, _chatId, authUser) {
      calls.push(['admin-handle', action, id, authUser]);
      return true;
    },
  };

  return {
    calls,
    service: new TelegramWebhookService(
      {},
      {},
      {},
      telegram,
      telegramStaff,
      undefined,
      undefined,
      adminMenu,
    ),
  };
}

test('linked Admin can execute admin-prefixed callbacks without shift requirement', async () => {
  const { service, calls } = harness({
    id: 'admin-1',
    fullName: 'Олена',
    role: 'admin',
    active: true,
    isArchived: false,
    isOnShift: false,
  });

  const result = await service.handleCallback(callback('admin:locations'));

  assert.deepEqual(result, { ok: true });
  const handled = calls.find((entry) => entry[0] === 'admin-handle');
  assert.ok(handled);
  assert.equal(handled[1], 'locations');
  assert.equal(handled[3].role, 'admin');
  assert.equal(handled[3].staffId, 'admin-1');
});

test('Waiter and Hookah cannot execute admin-prefixed callbacks', async () => {
  for (const role of ['waiter', 'hookah']) {
    const { service, calls } = harness({
      id: `${role}-1`,
      fullName: role,
      role,
      active: true,
      isArchived: false,
      isOnShift: true,
    });

    const result = await service.handleCallback(callback('admin:broadcast'));

    assert.deepEqual(result, { ok: false });
    assert.equal(calls.some((entry) => entry[0] === 'admin-handle'), false);
    assert.equal(
      calls.some((entry) => entry[0] === 'message' && /Недостатньо прав/.test(entry[1])),
      true,
    );
  }
});

test('unlinked Telegram user cannot execute admin-prefixed callbacks', async () => {
  const { service, calls } = harness(null);

  const result = await service.handleCallback(callback('admin:bookings:0'));

  assert.deepEqual(result, { ok: false });
  assert.equal(calls.some((entry) => entry[0] === 'admin-handle'), false);
});
