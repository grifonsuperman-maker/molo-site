const assert = require('node:assert/strict');
const test = require('node:test');

const {
  TelegramWebhookService,
} = require('../dist/telegram/telegram-webhook.service.js');

function createHarness() {
  const calls = [];
  const bookings = {
    async approve(id) {
      calls.push(['approve', id]);
    },
    async reject(id) {
      calls.push(['reject', id]);
    },
    async cancel(id) {
      calls.push(['cancel', id]);
    },
    async checkIn(id) {
      calls.push(['checkin', id]);
    },
    async complete(id) {
      calls.push(['complete', id]);
    },
    async rejectReschedule(id) {
      calls.push(['reschedule-reject', id]);
    },
  };
  const reschedule = {
    async approve(id) {
      calls.push(['reschedule-approve', id]);
    },
  };
  const restaurant = {
    async adminOpenRestaurant() {
      calls.push(['admin-restaurant-open']);
    },
    async adminCloseBooking() {
      calls.push(['admin-restaurant-close-booking']);
    },
    async adminCloseRestaurant() {
      calls.push(['admin-restaurant-close-full']);
    },
  };
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
    async findActiveStaffByTelegramId(telegramId) {
      calls.push(['staff-find', telegramId]);
      return {
        id: 'admin-1',
        fullName: 'Адміністратор',
        role: 'admin',
        active: true,
        isArchived: false,
        isOnShift: true,
      };
    },
  };

  return {
    calls,
    service: new TelegramWebhookService(
      bookings,
      reschedule,
      restaurant,
      telegram,
      telegramStaff,
    ),
  };
}

function callback(data) {
  return {
    id: 'callback-1',
    from: { id: 123 },
    message: { chat: { id: 999 } },
    data,
  };
}

test('unknown actions in protected Telegram callback families fail closed', async () => {
  const protectedCallbacks = [
    'menu:future_action',
    'waiter:future_action',
    'hookah:future_action',
    'admin:future_action',
    'booking:future_action:booking-1',
    'reschedule:future_action:request-1',
    'restaurant:future_action',
  ];

  for (const data of protectedCallbacks) {
    const { service, calls } = createHarness();

    assert.deepEqual(await service.handleCallback(callback(data)), { ok: false });
    assert.equal(
      calls.some((entry) => entry[0] === 'staff-find'),
      false,
      `${data} must be denied before actor lookup`,
    );
    assert.equal(
      calls.some(
        (entry) =>
          entry[0] === 'message' && /Недостатньо прав/.test(entry[2]),
      ),
      true,
      `${data} must return the authorization denial message`,
    );
    assert.equal(
      calls.some((entry) =>
        [
          'approve',
          'reject',
          'cancel',
          'checkin',
          'complete',
          'reschedule-approve',
          'reschedule-reject',
          'admin-restaurant-open',
          'admin-restaurant-close-booking',
          'admin-restaurant-close-full',
        ].includes(entry[0]),
      ),
      false,
      `${data} must not reach a privileged business action`,
    );
  }
});
