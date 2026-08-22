const assert = require('node:assert/strict');
const test = require('node:test');

const {
  TelegramAdminMenuService,
} = require('../dist/telegram/telegram-admin-menu.service.js');

const ACTOR = {
  sub: 'admin-1',
  telegramId: '777',
  role: 'admin',
  staffId: 'admin-1',
  name: 'Олена Адміністратор',
};

function harness() {
  const calls = [];
  const bookings = {
    async getToday() { return []; },
    async getPendingReschedules() { return []; },
  };
  const rescheduleApproval = {};
  const attention = {
    async dashboard() { return { tableChanges: [], reviews: [] }; },
  };
  const broadcasts = {
    async getTargetClients() {
      return [{ id: 'client-1', telegramId: '1001' }];
    },
    async sendNow() {
      throw new Error('sendNow must not be called in cancel test');
    },
  };
  const permissions = {
    async assert() {},
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
  const tables = { async findAll() { return []; } };
  const telegram = {
    async sendMessage(chatId, text, markup) {
      calls.push(['message', chatId, text, markup]);
      return { ok: true };
    },
  };

  return {
    calls,
    service: new TelegramAdminMenuService(
      bookings,
      rescheduleApproval,
      attention,
      broadcasts,
      permissions,
      restaurant,
      tables,
      telegram,
    ),
  };
}

function lastMessage(calls) {
  return [...calls].reverse().find((entry) => entry[0] === 'message');
}

function cancelCallback(messageCall) {
  return (messageCall?.[3]?.inline_keyboard || [])
    .flat()
    .find((button) => button.text === '❌ Скасувати')?.callback_data || null;
}

function draftId(callbackData) {
  return String(callbackData || '').split(':')[2] || null;
}

test('stale initial broadcast cancel cannot cancel a newer draft', async () => {
  const { service, calls } = harness();

  await service.handle('broadcast', undefined, 42, ACTOR);
  const firstCancel = cancelCallback(lastMessage(calls));
  assert.match(firstCancel, /^admin:broadcast_cancel:[a-f0-9]{16}$/);

  await service.handle('broadcast', undefined, 42, ACTOR);
  const secondCancel = cancelCallback(lastMessage(calls));
  assert.match(secondCancel, /^admin:broadcast_cancel:[a-f0-9]{16}$/);
  assert.notEqual(draftId(firstCancel), draftId(secondCancel));

  await assert.rejects(
    () => service.handle('broadcast_cancel', draftId(firstCancel), 42, ACTOR),
    /неактуальна/,
  );
  assert.equal(service.hasPendingInput('777'), true);

  await assert.rejects(
    () => service.handle('broadcast_cancel', undefined, 42, ACTOR),
    /неактуальна/,
  );
  assert.equal(service.hasPendingInput('777'), true);

  await service.handle('broadcast_cancel', draftId(secondCancel), 42, ACTOR);
  assert.equal(service.hasPendingInput('777'), false);
});
