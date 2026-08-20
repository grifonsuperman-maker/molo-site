const assert = require('node:assert/strict');
const test = require('node:test');

const {
  TelegramWebhookService,
} = require('../dist/telegram/telegram-webhook.service.js');

function callback(data) {
  return {
    id: 'callback-1',
    from: { id: 123 },
    message: { chat: { id: 999 } },
    data,
  };
}

test('Telegram check-in reuses the same employee snapshot that was authorized', async () => {
  const calls = [];
  let staffLookupCount = 0;
  const waiter = {
    id: '11111111-1111-4111-8111-111111111111',
    fullName: 'Олександр',
    role: 'waiter',
    active: true,
    isArchived: false,
    isOnShift: true,
  };

  const bookings = {
    async checkIn(id, actor) {
      calls.push(['checkin', id, actor]);
    },
  };
  const telegram = {
    async answerCallbackQuery() {
      return { ok: true };
    },
    async sendMessage() {
      return { ok: true };
    },
  };
  const telegramStaff = {
    async findActiveStaffByTelegramId() {
      staffLookupCount += 1;
      return staffLookupCount === 1 ? waiter : null;
    },
  };

  const service = new TelegramWebhookService(
    bookings,
    {},
    {},
    telegram,
    telegramStaff,
  );

  assert.deepEqual(
    await service.handleCallback(callback('booking:checkin:booking-1')),
    { ok: true },
  );

  assert.equal(staffLookupCount, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'checkin');
  assert.equal(calls[0][2].role, 'waiter');
  assert.equal(calls[0][2].staffId, waiter.id);
  assert.equal(calls[0][2].name, 'Олександр');
  assert.equal(calls[0][2].telegramId, '123');
});

test('Telegram completion also reuses the authorized employee snapshot', async () => {
  const calls = [];
  let staffLookupCount = 0;
  const waiter = {
    id: '22222222-2222-4222-8222-222222222222',
    fullName: 'Олександр',
    role: 'waiter',
    active: true,
    isArchived: false,
    isOnShift: true,
  };

  const bookings = {
    async complete(id, actor) {
      calls.push(['complete', id, actor]);
    },
  };
  const telegram = {
    async answerCallbackQuery() {
      return { ok: true };
    },
    async sendMessage() {
      return { ok: true };
    },
  };
  const telegramStaff = {
    async findActiveStaffByTelegramId() {
      staffLookupCount += 1;
      return staffLookupCount === 1 ? waiter : null;
    },
  };

  const service = new TelegramWebhookService(
    bookings,
    {},
    {},
    telegram,
    telegramStaff,
  );

  assert.deepEqual(
    await service.handleCallback(callback('booking:complete:booking-1')),
    { ok: true },
  );

  assert.equal(staffLookupCount, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'complete');
  assert.equal(calls[0][2].role, 'waiter');
  assert.equal(calls[0][2].staffId, waiter.id);
  assert.equal(calls[0][2].name, 'Олександр');
  assert.equal(calls[0][2].telegramId, '123');
});
