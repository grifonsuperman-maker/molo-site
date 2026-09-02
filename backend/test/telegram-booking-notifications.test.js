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
  if (!replyMarkup?.inline_keyboard) return [];
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

test('booking Telegram notifications keep phone text without broken callbacks', async () => {
  const { sent, service } = createNotificationsService();

  await service.notifyNewBooking(booking);
  await service.notifyRescheduleRequest({
    id: 'request-1',
    booking,
    requestedDate: '2026-08-17',
    requestedTime: '19:00',
  });
  await service.notifyLateGuest(booking);

  assert.equal(sent.length, 4);

  const [newBookingActions, newBookingWaiter, reschedule, lateGuest] = sent;
  assert.match(newBookingActions[1], /\+380501112233/);
  assert.match(newBookingWaiter[1], /\+380501112233/);
  assert.match(reschedule[1], /\+380501112233/);
  assert.match(lateGuest[1], /\+380501112233/);

  assert.deepEqual(callbacks(newBookingActions[2]), [
    'booking:approve:booking-1',
    'booking:reject:booking-1',
  ]);
  assert.deepEqual(callbacks(newBookingWaiter[2]), []);
  assert.deepEqual(callbacks(reschedule[2]), [
    'reschedule:approve:request-1',
    'reschedule:reject:request-1',
  ]);
  assert.deepEqual(callbacks(lateGuest[2]), [
    'booking:cancel:booking-1',
  ]);

  for (const message of sent) {
    const messageCallbacks = callbacks(message[2]);
    assert.equal(
      messageCallbacks.some((callback) => callback.startsWith('booking:call:')),
      false,
    );
    assert.equal(
      messageCallbacks.some((callback) => callback.startsWith('booking:change_time:')),
      false,
    );
  }
});

test('new booking action buttons go only to admin', async () => {
  const { service } = createNotificationsService();
  const deliveries = [];

  service.sendToRoles = async (roles, text, replyMarkup) => {
    deliveries.push({ roles, text, replyMarkup });
    return { attempted: 1, delivered: 1, failed: 0 };
  };

  await service.notifyNewBooking(booking);

  assert.equal(deliveries.length, 2);
  assert.deepEqual(deliveries[0].roles, ['admin']);
  assert.deepEqual(callbacks(deliveries[0].replyMarkup), [
    'booking:approve:booking-1',
    'booking:reject:booking-1',
  ]);
  assert.deepEqual(deliveries[1].roles, ['waiter']);
  assert.equal(deliveries[1].replyMarkup, undefined);
  assert.match(deliveries[1].text, /Нове бронювання/);
});

test('manual Admin booking notification goes only to waiter without approval buttons', async () => {
  const { service } = createNotificationsService();
  const deliveries = [];

  service.sendToRoles = async (roles, text, replyMarkup) => {
    deliveries.push({ roles, text, replyMarkup });
    return { attempted: 1, delivered: 1, failed: 0 };
  };

  await service.notifyManualBookingCreated(booking);

  assert.equal(deliveries.length, 1);
  assert.deepEqual(deliveries[0].roles, ['waiter']);
  assert.equal(deliveries[0].replyMarkup, undefined);
  assert.match(deliveries[0].text, /Нове бронювання/);
  assert.match(deliveries[0].text, /Створено Адміністратором/);
  assert.match(deliveries[0].text, /Дата: <b>2026-08-16<\/b>/);
  assert.deepEqual(callbacks(deliveries[0].replyMarkup), []);
});

test('Director is excluded from operational Telegram notifications', async () => {
  const { service } = createNotificationsService();
  const deliveries = [];

  service.sendToRoles = async (roles, text, replyMarkup) => {
    deliveries.push({ roles, text, replyMarkup });
    return { attempted: 1, delivered: 1, failed: 0 };
  };

  await service.notifyNewBooking(booking);
  await service.notifyBookingApproved(booking);
  await service.notifyBookingCancelled(booking);
  await service.notifyRescheduleRequest({
    id: 'request-1',
    booking,
    requestedDate: '2026-08-17',
    requestedTime: '19:00',
  });
  await service.notifyBookingCloseReminder();
  await service.notifyRestaurantCloseReminder();

  assert.ok(deliveries.length > 0);
  for (const delivery of deliveries) {
    assert.equal(delivery.roles.includes('owner'), false);
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

test('automatic late guest Telegram notification also targets only admin', async () => {
  const { service } = createNotificationsService();
  let delivery = null;

  service.sendToRoles = async (roles, text, replyMarkup) => {
    delivery = { roles, text, replyMarkup };
  };

  await service.notifyLateGuest(booking);

  assert.deepEqual(delivery.roles, ['admin']);
  assert.match(delivery.text, /Гість запізнюється/);
  assert.deepEqual(callbacks(delivery.replyMarkup), [
    'booking:cancel:booking-1',
  ]);
});

test('phone-less manual booking keeps its booking-specific guest name in Telegram notifications', async () => {
  const { service } = createNotificationsService();
  const deliveries = [];
  const manualBooking = {
    ...booking,
    id: 'manual-booking-1',
    source: 'admin_manual',
    guestName: 'Гість без телефону',
    client: null,
  };

  service.sendToRoles = async (roles, text, replyMarkup) => {
    deliveries.push({ roles, text, replyMarkup });
    return { attempted: 1, delivered: 1, failed: 0 };
  };

  await service.notifyManualBookingCreated(manualBooking);
  await service.notifyLateGuest(manualBooking);

  assert.equal(deliveries.length, 2);
  assert.match(deliveries[0].text, /Гість без телефону/);
  assert.match(deliveries[0].text, /Телефон: <b>-<\/b>/);
  assert.match(deliveries[1].text, /Гість без телефону/);
  assert.match(deliveries[1].text, /Телефон: <b>-<\/b>/);
});

test('off-shift waiter is excluded from operational Telegram notifications', async () => {
  const sent = [];
  const staffRepo = {
    async find() {
      return [
        {
          role: 'waiter',
          telegramId: 'waiter-on-shift',
          isOnShift: true,
        },
        {
          role: 'waiter',
          telegramId: 'waiter-off-shift',
          isOnShift: false,
        },
      ];
    },
  };
  const telegram = {
    async sendMessage(...args) {
      sent.push(args);
      return { ok: true };
    },
  };
  const service = new NotificationsService(staffRepo, telegram);

  const result = await service.sendToRoles(['waiter'], 'Робоче повідомлення');

  assert.deepEqual(sent.map((message) => message[0]), ['waiter-on-shift']);
  assert.deepEqual(result, { attempted: 1, delivered: 1, failed: 0 });
});