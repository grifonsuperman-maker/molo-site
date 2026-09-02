const assert = require('node:assert/strict');
const test = require('node:test');

const {
  NotificationsService,
} = require('../dist/notifications/notifications.service.js');

function createService(messages) {
  const staffRepo = {
    async find() {
      return [
        {
          role: 'waiter',
          active: true,
          isOnShift: true,
          telegramId: 'waiter-1',
        },
      ];
    },
  };
  const telegramService = {
    async sendMessage(chatId, text, markup) {
      messages.push([chatId, text, markup]);
      return { ok: true };
    },
  };
  return new NotificationsService(staffRepo, telegramService);
}

function manualBooking(overrides = {}) {
  return {
    id: 'booking-1',
    source: 'admin_manual',
    guestName: 'Марина',
    client: {
      fullName: 'Андрій',
      phone: '+380000000000',
    },
    table: { tableNumber: '15' },
    bookingDate: '2026-09-10',
    bookingTime: '18:30:00',
    guestsCount: 2,
    wishes: null,
    durationMinutes: 120,
    ...overrides,
  };
}

test('manual booking notification prefers the name entered for this booking over an existing client name', async () => {
  const messages = [];
  const service = createService(messages);

  await service.notifyManualBookingCreated(manualBooking());

  assert.equal(messages.length, 1);
  assert.match(messages[0][1], /Імʼя: <b>Марина<\/b>/);
  assert.doesNotMatch(messages[0][1], /Андрій/);
});

test('manual booking guest name is escaped before Telegram HTML delivery', async () => {
  const messages = [];
  const service = createService(messages);

  await service.notifyManualBookingCreated(
    manualBooking({
      guestName: 'Марина <VIP & Co>',
      client: null,
    }),
  );

  assert.equal(messages.length, 1);
  assert.match(messages[0][1], /Марина &lt;VIP &amp; Co&gt;/);
  assert.doesNotMatch(messages[0][1], /Марина <VIP & Co>/);
});
