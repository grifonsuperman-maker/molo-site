const assert = require('node:assert/strict');
const test = require('node:test');

const {
  TelegramWaiterMenuResolvedService,
} = require('../dist/telegram/telegram-waiter-menu-resolved.service.js');

const actor = {
  sub: 'waiter-1',
  telegramId: '123',
  role: 'waiter',
  staffId: 'waiter-1',
  name: 'Олександр',
};

function booking(index) {
  return {
    id: `booking-${index}`,
    status: 'approved',
    bookingDate: '2099-01-01',
    bookingTime: `${String(index % 24).padStart(2, '0')}:00:00`,
    guestsCount: 2,
    checkedInAt: new Date('2099-01-01T12:00:00Z'),
    assignedWaiterId: null,
    assignedWaiterName: null,
    table: {
      id: `table-${index}`,
      tableNumber: String(index + 1),
      seats: 4,
      status: 'occupied',
      isVisible: true,
      zone: { name: 'Зал ресторану' },
    },
    client: { fullName: `Гість ${index + 1}` },
  };
}

function callbacks(message) {
  return message.replyMarkup.inline_keyboard
    .flat()
    .map((button) => button.callback_data)
    .filter(Boolean);
}

test('My tables includes a booking assigned by an accepted waiter call', async () => {
  const messages = [];
  const bookings = [booking(0)];
  let assignmentLookups = 0;

  const service = new TelegramWaiterMenuResolvedService(
    { async getToday() { return bookings; } },
    {
      async assignmentForBooking(currentBooking) {
        assignmentLookups += 1;
        assert.equal(currentBooking.id, 'booking-0');
        return {
          bookingId: currentBooking.id,
          tableId: currentBooking.table.id,
          tableNumber: currentBooking.table.tableNumber,
          waiterId: 'waiter-1',
          waiterName: 'Олександр',
          assignedAt: '2099-01-01T12:05:00.000Z',
        };
      },
    },
    { async findAll() { return []; } },
    {
      async sendMessage(chatId, text, replyMarkup) {
        messages.push({ chatId, text, replyMarkup });
        return { ok: true };
      },
    },
  );

  assert.equal(await service.handle('mine', undefined, 999, actor), true);
  assert.equal(assignmentLookups, 1);
  assert.equal(callbacks(messages.at(-1)).includes('waiter:booking:booking-0'), true);
});

test('My tables keeps call-based assignments reachable beyond fifty bookings', async () => {
  const messages = [];
  const bookings = Array.from({ length: 65 }, (_, index) => booking(index));

  const service = new TelegramWaiterMenuResolvedService(
    { async getToday() { return bookings; } },
    {
      async assignmentForBooking(currentBooking) {
        return {
          bookingId: currentBooking.id,
          tableId: currentBooking.table.id,
          tableNumber: currentBooking.table.tableNumber,
          waiterId: 'waiter-1',
          waiterName: 'Олександр',
          assignedAt: '2099-01-01T12:05:00.000Z',
        };
      },
    },
    { async findAll() { return []; } },
    {
      async sendMessage(chatId, text, replyMarkup) {
        messages.push({ chatId, text, replyMarkup });
        return { ok: true };
      },
    },
  );

  await service.handle('mine', '6', 999, actor);
  const pageCallbacks = callbacks(messages.at(-1));

  assert.equal(pageCallbacks.includes('waiter:booking:booking-60'), true);
  assert.equal(pageCallbacks.includes('waiter:booking:booking-64'), true);
  assert.equal(pageCallbacks.includes('waiter:mine:5'), true);
});

test('My tables retains uncapped booking-history assignments without extra lookup', async () => {
  const messages = [];
  const bookings = Array.from({ length: 65 }, (_, index) => ({
    ...booking(index),
    assignedWaiterId: 'waiter-1',
    assignedWaiterName: 'Олександр',
  }));
  let assignmentLookups = 0;

  const service = new TelegramWaiterMenuResolvedService(
    { async getToday() { return bookings; } },
    {
      async assignmentForBooking() {
        assignmentLookups += 1;
        return null;
      },
    },
    { async findAll() { return []; } },
    {
      async sendMessage(chatId, text, replyMarkup) {
        messages.push({ chatId, text, replyMarkup });
        return { ok: true };
      },
    },
  );

  await service.handle('mine', '6', 999, actor);

  assert.equal(assignmentLookups, 0);
  assert.equal(callbacks(messages.at(-1)).includes('waiter:booking:booking-64'), true);
});
