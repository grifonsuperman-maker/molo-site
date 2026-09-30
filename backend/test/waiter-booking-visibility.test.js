require('reflect-metadata');

const assert = require('node:assert/strict');
const test = require('node:test');
const { waiterCanSeeBooking } = require('../dist/bookings/waiter-booking-visibility.js');
const { BookingsController } = require('../dist/bookings/bookings.controller.js');
const { TelegramWaiterMenuResolvedService } = require('../dist/telegram/telegram-waiter-menu-resolved.service.js');

const manual = (id, assignedWaiterId = null, checkedInAt = null, status = 'approved') => ({
  id,
  source: 'admin_manual',
  status,
  assignedWaiterId,
  checkedInAt,
  table: { id: `table-${id}`, tableNumber: '8' },
  bookingTime: '19:00:00',
  client: { fullName: 'Гість' },
});

const bookings = [
  manual('waiting'),
  manual('serhii', 'serhii', new Date()),
  manual('andrii', 'andrii', new Date()),
  { ...manual('online', 'serhii', new Date()), source: 'mini_app' },
  manual('completed-other', 'serhii', new Date(), 'completed'),
];

test('only active manual booking accepted by another waiter disappears', () => {
  assert.equal(waiterCanSeeBooking(bookings[0], 'andrii'), true);
  assert.equal(waiterCanSeeBooking(bookings[1], 'serhii'), true);
  assert.equal(waiterCanSeeBooking(bookings[1], 'andrii'), false);
  assert.equal(waiterCanSeeBooking(bookings[2], 'serhii'), false);
  assert.equal(waiterCanSeeBooking(bookings[3], 'andrii'), true);
});

test('completed manual booking always remains visible in waiter history', () => {
  assert.equal(waiterCanSeeBooking(bookings[4], 'andrii'), true);
  assert.equal(waiterCanSeeBooking(bookings[4], 'serhii'), true);
});

test('unassigned manual booking remains shared after administrator check-in', () => {
  assert.equal(waiterCanSeeBooking(manual('admin-arrival', null, new Date()), 'andrii'), true);
  assert.equal(waiterCanSeeBooking(manual('before-arrival', 'serhii', null), 'andrii'), true);
  assert.equal(waiterCanSeeBooking(bookings[1], null), false);
});

test('site today filters active manual visits only for waiters', async () => {
  const controller = new BookingsController({ getToday: async () => bookings });
  const waiterList = await controller.today({ user: { role: 'waiter', staffId: 'andrii' } });
  assert.deepEqual(
    waiterList.map((item) => item.id),
    ['waiting', 'andrii', 'online', 'completed-other'],
  );

  for (const role of ['admin', 'owner']) {
    const result = await controller.today({ user: { role, staffId: null } });
    assert.deepEqual(result, bookings);
  }
});

function telegramHarness() {
  const messages = [];
  const menu = new TelegramWaiterMenuResolvedService(
    { getToday: async () => bookings },
    {},
    {},
    {
      async sendMessage(chatId, text, replyMarkup) {
        messages.push({ chatId, text, replyMarkup });
      },
    },
    { async bookingIdsForWaiter() { return []; } },
  );
  return { menu, messages };
}

test('Telegram all bookings hides another waiter active manual visit', async () => {
  const { menu, messages } = telegramHarness();
  const actor = { role: 'waiter', staffId: 'serhii' };

  assert.equal(await menu.handle('bookings', undefined, 'chat', actor), true);
  const links = messages[0].replyMarkup.inline_keyboard
    .flat()
    .map((button) => button.callback_data);

  assert.ok(links.includes('waiter:booking:waiting'));
  assert.ok(links.includes('waiter:booking:serhii'));
  assert.ok(!links.includes('waiter:booking:andrii'));
  assert.ok(links.includes('waiter:booking:online'));
});

test('old Telegram callback cannot open another waiter active manual booking', async () => {
  const { menu } = telegramHarness();
  const actor = { role: 'waiter', staffId: 'andrii' };

  for (const action of ['booking', 'booking_checkin', 'booking_cleaning', 'booking_complete']) {
    await assert.rejects(
      menu.handle(action, 'serhii', 'chat', actor),
      /Бронювання не знайдено/,
    );
  }
});
