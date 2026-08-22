const assert = require('node:assert/strict');
const test = require('node:test');

const {
  TelegramAdminMenuService,
} = require('../dist/telegram/telegram-admin-menu.service.js');
const {
  TelegramWebhookService,
} = require('../dist/telegram/telegram-webhook.service.js');

const ACTOR = {
  sub: 'admin-1',
  telegramId: '777',
  role: 'admin',
  staffId: 'admin-1',
  name: 'Олена Адміністратор',
};

function adminStaff() {
  return {
    id: 'admin-1',
    fullName: 'Олена Адміністратор',
    role: 'admin',
    isOnShift: false,
  };
}

test('real Admin online-booking callbacks delegate to the best-effort menu handler', async () => {
  const calls = [];
  const restaurant = {
    async adminOpenBooking() { calls.push(['direct-open']); },
    async adminCloseBooking() { calls.push(['direct-close']); },
  };
  const telegram = {
    async answerCallbackQuery() { return { ok: true }; },
    async sendMessage() { return { ok: true }; },
  };
  const telegramStaff = {
    async findActiveStaffByTelegramId(id) {
      assert.equal(id, '777');
      return adminStaff();
    },
  };
  const adminMenu = {
    async handle(action, id, chatId, actor) {
      calls.push(['menu', action, id, chatId, actor.role]);
      return true;
    },
  };
  const service = new TelegramWebhookService(
    {},
    {},
    restaurant,
    telegram,
    telegramStaff,
    undefined,
    undefined,
    adminMenu,
  );

  for (const action of ['booking_open', 'booking_close']) {
    const result = await service.handleCallback({
      id: `cb-${action}`,
      from: { id: 777 },
      data: `admin:${action}`,
      message: { chat: { id: 42 } },
    });
    assert.equal(result.ok, true);
  }

  assert.deepEqual(
    calls.filter((entry) => entry[0] === 'menu').map((entry) => entry[1]),
    ['booking_open', 'booking_close'],
  );
  assert.equal(calls.some((entry) => entry[0] === 'direct-open'), false);
  assert.equal(calls.some((entry) => entry[0] === 'direct-close'), false);
});

test('successful broadcast stays successful when Telegram receipt and menu refresh fail', async () => {
  const calls = [];
  let broadcastDelivered = false;

  const bookings = {
    async getToday() { return []; },
    async getPendingReschedules() { return []; },
  };
  const attention = {
    async dashboard() { return { tableChanges: [], reviews: [] }; },
  };
  const broadcasts = {
    async getTargetClients() {
      return [{ id: 'client-1', telegramId: '1001' }];
    },
    async sendNow(payload) {
      calls.push(['broadcast-send', payload]);
      broadcastDelivered = true;
      return { recipientCount: 1, deliveredCount: 1, unreachableCount: 0 };
    },
  };
  const permissions = {
    async assert() { return undefined; },
  };
  const restaurant = {
    async getRestaurant() {
      return {
        status: 'open',
        adminCanSendBroadcasts: true,
        adminCanManageOnlineBooking: true,
        adminCanManageRestaurant: true,
      };
    },
  };
  const telegram = {
    async sendMessage(chatId, text, markup) {
      calls.push(['message', chatId, text, markup]);
      if (broadcastDelivered) {
        throw new Error('temporary Telegram send failure');
      }
      return { ok: true };
    },
  };

  const service = new TelegramAdminMenuService(
    bookings,
    {},
    attention,
    broadcasts,
    permissions,
    restaurant,
    {},
    telegram,
  );

  await service.handle('broadcast', undefined, 42, ACTOR);
  await service.handleText('Тестова розсилка', 42, ACTOR);

  const preview = [...calls]
    .reverse()
    .find((entry) => entry[0] === 'message' && entry[3]?.inline_keyboard);
  const confirmData = preview[3].inline_keyboard
    .flat()
    .find((button) => button.text === '✅ Надіслати всім').callback_data;
  const draftId = confirmData.split(':')[2];

  const handled = await service.handle(
    'broadcast_confirm',
    draftId,
    42,
    ACTOR,
    'https://molo.example/app#admin',
  );

  assert.equal(handled, true);
  assert.equal(calls.filter((entry) => entry[0] === 'broadcast-send').length, 1);
  assert.equal(service.hasPendingInput('777'), false);
});
