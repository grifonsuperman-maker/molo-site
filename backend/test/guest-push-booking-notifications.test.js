require('reflect-metadata');

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  NotificationsService,
} = require('../dist/notifications/notifications.service.js');

function notificationsHarness() {
  const pushes = [];
  const service = new NotificationsService(
    { async find() { return []; } },
    { async sendMessage() { return { ok: true }; } },
    {
      async sendBookingNotification(bookingId, body) {
        pushes.push({ bookingId, body });
        return { attempted: 1, delivered: 1, failed: 0 };
      },
    },
  );
  return { service, pushes };
}

test('approved booking Push contains current booking details but no guest identity', async () => {
  const { service, pushes } = notificationsHarness();
  await service.notifyBookingApproved({
    id: 'booking-1',
    bookingDate: '2026-09-24',
    bookingTime: '19:30:00',
    table: { tableNumber: '8' },
    client: { fullName: 'Приватне імʼя', phone: '+380000000000' },
    guestNotification: null,
  });

  assert.equal(pushes.length, 1);
  assert.equal(pushes[0].bookingId, 'booking-1');
  assert.match(pushes[0].body, /Бронювання підтверджено/);
  assert.match(pushes[0].body, /2026-09-24/);
  assert.match(pushes[0].body, /19:30/);
  assert.match(pushes[0].body, /Стіл №8/);
  assert.doesNotMatch(pushes[0].body, /Приватне ім/);
  assert.doesNotMatch(pushes[0].body, /380000/);
});

test('ordinary cancellation ignores an older unrelated guestNotification', async () => {
  const { service, pushes } = notificationsHarness();

  await service.notifyBookingCancelled({
    id: 'booking-4',
    bookingDate: '2026-09-27',
    bookingTime: '18:00:00',
    cancellationReason: 'admin_cancelled',
    table: { tableNumber: '4' },
    client: null,
    guestNotification: {
      type: 'booking_updated',
      title: 'Старий стіл',
      message: 'Це попереднє повідомлення.',
    },
  });

  assert.equal(pushes.length, 1);
  assert.match(pushes[0].body, /Бронювання скасовано/);
  assert.match(pushes[0].body, /2026-09-27/);
  assert.doesNotMatch(pushes[0].body, /Старий стіл|попереднє повідомлення/);
});

test('site guestNotification text is reused for no-show, reschedule and table decisions', async () => {
  const { service, pushes } = notificationsHarness();

  await service.notifyBookingCancelled({
    id: 'booking-1',
    bookingDate: '2026-09-24',
    bookingTime: '19:30:00',
    cancellationReason: 'no_show',
    table: { tableNumber: '8' },
    client: null,
    guestNotification: {
      title: 'Ваше бронювання анульовано',
      message: 'Бронювання анульовано через неявку протягом 30 хвилин.',
    },
  });

  const telegramSummary = await service.notifyGuestRescheduleDecision({
    bookingId: 'booking-2',
    telegramId: null,
    decision: 'approved',
    bookingDate: '2026-09-25',
    bookingTime: '20:00:00',
    guestNotification: {
      title: 'Зміну часу підтверджено',
      message: 'Нове бронювання: 2026-09-25 о 20:00.',
    },
  });

  await service.notifyGuestBookingUpdated({
    id: 'booking-3',
    bookingDate: '2026-09-26',
    bookingTime: '21:00:00',
    table: { tableNumber: '9' },
    client: null,
    guestNotification: {
      title: 'Новий стіл підтверджено',
      message: 'Ваше бронювання перенесено зі столу №8 на стіл №9.',
    },
  });

  assert.deepEqual(telegramSummary, { attempted: 0, delivered: 0, failed: 0 });
  assert.deepEqual(pushes, [
    {
      bookingId: 'booking-1',
      body: 'Ваше бронювання анульовано\nБронювання анульовано через неявку протягом 30 хвилин.',
    },
    {
      bookingId: 'booking-2',
      body: 'Зміну часу підтверджено\nНове бронювання: 2026-09-25 о 20:00.',
    },
    {
      bookingId: 'booking-3',
      body: 'Новий стіл підтверджено\nВаше бронювання перенесено зі столу №8 на стіл №9.',
    },
  ]);
});

test('connected state-change services publish the guest notification after persistence', () => {
  const attention = fs.readFileSync(
    path.resolve(__dirname, '../src/bookings/admin-attention.service.ts'),
    'utf8',
  );
  const reschedule = fs.readFileSync(
    path.resolve(__dirname, '../src/bookings/booking-reschedule-approval.service.ts'),
    'utf8',
  );
  const bookings = fs.readFileSync(
    path.resolve(__dirname, '../src/bookings/bookings.service.ts'),
    'utf8',
  );
  const noShow = fs.readFileSync(
    path.resolve(__dirname, '../src/schedules/automatic-no-show.service.ts'),
    'utf8',
  );

  const tableStart = attention.indexOf('async approveTableChange');
  const tableNotify = attention.indexOf(
    'await this.notifyGuestBookingUpdated(result.booking)',
    tableStart,
  );
  assert.ok(tableStart >= 0 && tableNotify > tableStart);
  assert.match(
    attention.slice(tableStart, tableNotify),
    /const result = await this\.dataSource\.transaction/,
  );

  assert.match(reschedule, /bookingId: booking\.id/);
  assert.match(reschedule, /guestNotification: booking\.guestNotification/);
  assert.match(bookings, /bookingId: result\.booking\.id/);
  assert.match(bookings, /guestNotification: result\.booking\.guestNotification/);
  assert.match(noShow, /await this\.notifications\.notifyBookingCancelled\(cancelled\)/);
});
