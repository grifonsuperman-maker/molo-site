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

function createService(booking, options = {}) {
  const calls = [];
  const bookings = {
    async getToday() {
      calls.push(['getToday']);
      return [booking];
    },
    async getPendingReschedules() {
      calls.push(['getPendingReschedules']);
      return [];
    },
    async approve(id) {
      calls.push(['approve', id]);
      booking.status = 'approved';
      booking.approvedAt = new Date();
    },
    async reject(id) {
      calls.push(['reject', id]);
      booking.status = 'rejected';
    },
    async checkIn(id) {
      calls.push(['checkin', id]);
      booking.status = 'approved';
      booking.checkedInAt = new Date();
    },
    async complete(id) {
      calls.push(['complete', id]);
      booking.status = 'completed';
    },
    async rejectReschedule(id) {
      calls.push(['rescheduleReject', id]);
    },
  };

  const rescheduleApproval = {
    async approve(id) {
      calls.push(['rescheduleApprove', id]);
    },
  };

  const telegram = {
    async sendMessage(chatId, text, markup) {
      calls.push(['message', chatId, text, markup]);
      if (options.telegramError) throw options.telegramError;
      return { ok: true };
    },
  };

  return {
    calls,
    service: new TelegramAdminMenuService(
      bookings,
      rescheduleApproval,
      {},
      {},
      {},
      {},
      {},
      telegram,
    ),
  };
}

function pendingBooking() {
  return {
    id: 'booking-1',
    status: 'pending',
    bookingDate: '2026-08-22',
    bookingTime: '19:00:00',
    checkedInAt: null,
    guestsCount: 2,
    table: { tableNumber: '1', zone: { name: 'Зал ресторану' } },
    client: { fullName: 'Гість', phone: '+380000000001' },
  };
}

test('successful Admin approve stays successful when Telegram refresh fails', async () => {
  const booking = pendingBooking();
  const { service, calls } = createService(booking, {
    telegramError: new Error('temporary Telegram send failure'),
  });

  const handled = await service.handle(
    'booking_approve',
    booking.id,
    42,
    ACTOR,
  );

  assert.equal(handled, true);
  assert.equal(booking.status, 'approved');
  assert.equal(
    calls.filter((entry) => entry[0] === 'approve').length,
    1,
  );
});

test('stale Admin approve button cannot approve an already approved booking again', async () => {
  const booking = pendingBooking();
  booking.status = 'approved';
  const { service, calls } = createService(booking);

  const handled = await service.handle(
    'booking_approve',
    booking.id,
    42,
    ACTOR,
  );

  assert.equal(handled, true);
  assert.equal(
    calls.filter((entry) => entry[0] === 'approve').length,
    0,
  );
  assert.equal(
    calls.some(
      (entry) =>
        entry[0] === 'message' &&
        String(entry[2]).includes('Ця дія вже неактуальна'),
    ),
    true,
  );
});

test('successful Admin reschedule approval stays successful when Telegram refresh fails', async () => {
  const booking = pendingBooking();
  const { service, calls } = createService(booking, {
    telegramError: new Error('temporary Telegram send failure'),
  });

  const handled = await service.handle(
    'reschedule_approve',
    'reschedule-1',
    42,
    ACTOR,
  );

  assert.equal(handled, true);
  assert.equal(
    calls.filter((entry) => entry[0] === 'rescheduleApprove').length,
    1,
  );
});

test('successful Admin reschedule rejection stays successful when Telegram refresh fails', async () => {
  const booking = pendingBooking();
  const { service, calls } = createService(booking, {
    telegramError: new Error('temporary Telegram send failure'),
  });

  const handled = await service.handle(
    'reschedule_reject',
    'reschedule-1',
    42,
    ACTOR,
  );

  assert.equal(handled, true);
  assert.equal(
    calls.filter((entry) => entry[0] === 'rescheduleReject').length,
    1,
  );
});
