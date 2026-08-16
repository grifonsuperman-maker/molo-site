require('reflect-metadata');

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  NotificationsService,
} = require('../dist/notifications/notifications.service.js');

function createNotificationsService() {
  const sent = [];
  const staffRepo = {
    async find() {
      return [{ telegramId: '123456' }];
    },
  };
  const telegram = {
    async sendMessage(...args) {
      sent.push(args);
      return { ok: true };
    },
  };

  return {
    sent,
    service: new NotificationsService(staffRepo, telegram),
  };
}

function callbacks(replyMarkup) {
  return replyMarkup.inline_keyboard
    .flat()
    .map((button) => button.callback_data)
    .filter(Boolean);
}

const booking = {
  id: 'booking-1',
  bookingDate: '2026-08-16',
  bookingTime: '18:30',
  guestsCount: 4,
  wishes: '',
  table: { tableNumber: '7' },
  client: {
    fullName: 'Тестовий гість',
    phone: '+380501112233',
  },
};

test('booking Telegram notifications keep phone text without broken booking:call callbacks', async () => {
  const { sent, service } = createNotificationsService();

  await service.notifyNewBooking(booking);
  await service.notifyRescheduleRequest({
    id: 'request-1',
    booking,
    requestedDate: '2026-08-17',
    requestedTime: '19:00',
  });
  await service.notifyLateGuest(booking);

  assert.equal(sent.length, 3);

  const [newBooking, reschedule, lateGuest] = sent;
  assert.match(newBooking[1], /\+380501112233/);
  assert.match(reschedule[1], /\+380501112233/);
  assert.match(lateGuest[1], /\+380501112233/);

  assert.deepEqual(callbacks(newBooking[2]), [
    'booking:approve:booking-1',
    'booking:reject:booking-1',
  ]);
  assert.deepEqual(callbacks(reschedule[2]), [
    'reschedule:approve:request-1',
    'reschedule:reject:request-1',
  ]);
  assert.deepEqual(callbacks(lateGuest[2]), [
    'booking:cancel:booking-1',
    'booking:change_time:booking-1',
  ]);

  for (const message of sent) {
    assert.equal(
      callbacks(message[2]).some((callback) => callback.startsWith('booking:call:')),
      false,
    );
  }
});

test('guest-reported lateness Telegram notification targets only admin without buttons', async () => {
  const { service } = createNotificationsService();
  let delivery = null;

  service.sendToRoles = async (roles, text, replyMarkup) => {
    delivery = { roles, text, replyMarkup };
  };

  await service.notifyGuestReportedLateness({
    tableNumber: '8',
    bookingDate: '2026-08-16',
    bookingTime: '16:37',
    latenessHours: 0,
    latenessMinutes: 15,
  });

  assert.deepEqual(delivery.roles, ['admin']);
  assert.match(delivery.text, /Гість повідомив про запізнення/);
  assert.match(delivery.text, /Стіл: <b>8<\/b>/);
  assert.match(delivery.text, /Час бронювання: <b>16:37<\/b>/);
  assert.match(delivery.text, /Запізнення: <b>15 хв<\/b>/);
  assert.equal(delivery.replyMarkup, undefined);
});
