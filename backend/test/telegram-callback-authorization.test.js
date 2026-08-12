const assert = require('node:assert/strict');
const test = require('node:test');

const {
  TelegramWebhookService,
} = require('../dist/telegram/telegram-webhook.service.js');

function createHarness(actor) {
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
    async openRestaurant() {
      calls.push(['restaurant-open']);
    },
    async closeBooking() {
      calls.push(['restaurant-close-booking']);
    },
    async closeRestaurant() {
      calls.push(['restaurant-close-full']);
    },
  };
  const telegram = {
    async answerCallbackQuery(id) {
      calls.push(['answer', id]);
    },
    async sendMessage(chatId, text) {
      calls.push(['message', chatId, text]);
    },
  };
  const staffRepo = {
    async findOne(options) {
      calls.push(['staff-find', options.where.telegramId]);
      return actor;
    },
  };

  return {
    calls,
    service: new TelegramWebhookService(
      bookings,
      reschedule,
      restaurant,
      telegram,
      staffRepo,
    ),
  };
}

function callback(data, fromId = 123) {
  return {
    id: 'callback-1',
    from: { id: fromId },
    message: { chat: { id: 42 } },
    data,
  };
}

test('unlinked Telegram user cannot execute a protected booking callback', async () => {
  const { service, calls } = createHarness(null);

  const result = await service.handleCallback(callback('booking:approve:booking-1'));

  assert.deepEqual(result, { ok: false });
  assert.equal(calls.some(([name]) => name === 'approve'), false);
  assert.equal(calls.some((entry) => entry[0] === 'staff-find' && entry[1] === '123'), true);
  assert.equal(
    calls.some((entry) => entry[0] === 'message' && /Недостатньо прав/.test(entry[2])),
    true,
  );
});

test('Admin can approve a booking through Telegram callback', async () => {
  const { service, calls } = createHarness({
    role: 'admin',
    active: true,
    isArchived: false,
    isOnShift: false,
  });

  const result = await service.handleCallback(callback('booking:approve:booking-1'));

  assert.deepEqual(result, { ok: true });
  assert.equal(calls.some((entry) => entry[0] === 'approve' && entry[1] === 'booking-1'), true);
});

test('Waiter on shift can check in a booking but cannot approve it', async () => {
  const actor = {
    role: 'waiter',
    active: true,
    isArchived: false,
    isOnShift: true,
  };
  const allowed = createHarness(actor);
  const denied = createHarness(actor);

  assert.deepEqual(
    await allowed.service.handleCallback(callback('booking:checkin:booking-1')),
    { ok: true },
  );
  assert.equal(allowed.calls.some((entry) => entry[0] === 'checkin'), true);

  assert.deepEqual(
    await denied.service.handleCallback(callback('booking:approve:booking-1')),
    { ok: false },
  );
  assert.equal(denied.calls.some((entry) => entry[0] === 'approve'), false);
});

test('Waiter off shift cannot execute waiter callback', async () => {
  const { service, calls } = createHarness({
    role: 'waiter',
    active: true,
    isArchived: false,
    isOnShift: false,
  });

  const result = await service.handleCallback(callback('booking:complete:booking-1'));

  assert.deepEqual(result, { ok: false });
  assert.equal(calls.some((entry) => entry[0] === 'complete'), false);
});

test('unknown callback remains non-privileged and keeps existing response', async () => {
  const { service, calls } = createHarness(null);

  const result = await service.handleCallback(callback('unknown:action'));

  assert.deepEqual(result, { ok: true });
  assert.equal(calls.some((entry) => entry[0] === 'staff-find'), false);
  assert.equal(
    calls.some((entry) => entry[0] === 'message' && /не розпізнано/.test(entry[2])),
    true,
  );
});
