const assert = require('node:assert/strict');
const test = require('node:test');

const {
  TelegramWaiterMenuService,
} = require('../dist/telegram/telegram-waiter-menu.service.js');

const actor = {
  sub: 'waiter-1',
  telegramId: '123',
  role: 'waiter',
  staffId: 'waiter-1',
  name: 'Олександр',
};

function keyboardCallbacks(message) {
  return message.replyMarkup.inline_keyboard
    .flat()
    .map((button) => button.callback_data)
    .filter(Boolean);
}

test('waiter Telegram pages keep every active call reachable', async () => {
  const messages = [];
  const calls = Array.from({ length: 25 }, (_, index) => ({
    id: `call-${index}`,
    bookingId: `booking-${index}`,
    tableId: `table-${index}`,
    tableNumber: String(index + 1),
    clientName: `Гість ${index + 1}`,
    waiterId: null,
    waiterName: null,
    status: 'new',
    createdAt: new Date(2099, 0, 1, 12, index).toISOString(),
    acceptedAt: null,
    closedAt: null,
  }));

  const service = new TelegramWaiterMenuService(
    { async getToday() { return []; } },
    {
      async list() { return calls; },
      async myAssignments() { return []; },
    },
    { async findAll() { return []; } },
    {
      async sendMessage(chatId, text, replyMarkup) {
        messages.push({ chatId, text, replyMarkup });
        return { ok: true };
      },
    },
  );

  await service.handle('calls', undefined, 999, actor);
  let callbacks = keyboardCallbacks(messages.at(-1));
  assert.equal(callbacks.includes('waiter:call:call-0'), true);
  assert.equal(callbacks.includes('waiter:calls:1'), true);

  await service.handle('calls', '1', 999, actor);
  callbacks = keyboardCallbacks(messages.at(-1));
  assert.equal(callbacks.includes('waiter:call:call-10'), true);
  assert.equal(callbacks.includes('waiter:calls:0'), true);
  assert.equal(callbacks.includes('waiter:calls:2'), true);

  await service.handle('calls', '2', 999, actor);
  callbacks = keyboardCallbacks(messages.at(-1));
  assert.equal(callbacks.includes('waiter:call:call-24'), true);
});

test('waiter Telegram pages keep every booking reachable', async () => {
  const messages = [];
  const bookings = Array.from({ length: 25 }, (_, index) => ({
    id: `booking-${index}`,
    status: 'approved',
    bookingDate: '2099-01-01',
    bookingTime: `${String(index % 24).padStart(2, '0')}:00:00`,
    guestsCount: 2,
    checkedInAt: null,
    table: {
      id: `table-${index}`,
      tableNumber: String(index + 1),
      seats: 4,
      status: 'reserved',
      isVisible: true,
      zone: { name: 'Зал ресторану' },
    },
    client: { fullName: `Гість ${index + 1}` },
  }));

  const service = new TelegramWaiterMenuService(
    { async getToday() { return bookings; } },
    {
      async list() { return []; },
      async myAssignments() { return []; },
    },
    { async findAll() { return []; } },
    {
      async sendMessage(chatId, text, replyMarkup) {
        messages.push({ chatId, text, replyMarkup });
        return { ok: true };
      },
    },
  );

  await service.handle('bookings', undefined, 999, actor);
  let callbacks = keyboardCallbacks(messages.at(-1));
  assert.equal(callbacks.includes('waiter:booking:booking-0'), true);
  assert.equal(callbacks.includes('waiter:bookings:1'), true);

  await service.handle('bookings', '1', 999, actor);
  callbacks = keyboardCallbacks(messages.at(-1));
  assert.equal(callbacks.includes('waiter:booking:booking-10'), true);
  assert.equal(callbacks.includes('waiter:bookings:0'), true);
  assert.equal(callbacks.includes('waiter:bookings:2'), true);

  await service.handle('bookings', '2', 999, actor);
  callbacks = keyboardCallbacks(messages.at(-1));
  assert.equal(callbacks.includes('waiter:booking:booking-24'), true);
});

test('My tables uses booking assignment data and keeps assignments beyond 50 reachable', async () => {
  const messages = [];
  const bookings = Array.from({ length: 65 }, (_, index) => ({
    id: `mine-${index}`,
    status: 'approved',
    bookingDate: '2099-01-01',
    bookingTime: `${String(index % 24).padStart(2, '0')}:30:00`,
    guestsCount: 2,
    checkedInAt: new Date('2099-01-01T12:00:00.000Z'),
    assignedWaiterId: 'waiter-1',
    assignedWaiterName: 'Олександр',
    table: {
      id: `mine-table-${index}`,
      tableNumber: String(index + 1),
      seats: 4,
      status: 'occupied',
      isVisible: true,
      zone: { name: 'Зал ресторану' },
    },
    client: { fullName: `Гість ${index + 1}` },
  }));

  const service = new TelegramWaiterMenuService(
    { async getToday() { return bookings; } },
    {
      async list() { return []; },
      async myAssignments() {
        throw new Error('My tables must not depend on the capped assignment list');
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
  const callbacks = keyboardCallbacks(messages.at(-1));
  assert.equal(callbacks.includes('waiter:booking:mine-60'), true);
  assert.equal(callbacks.includes('waiter:booking:mine-64'), true);
  assert.equal(callbacks.includes('waiter:mine:5'), true);
  assert.equal(callbacks.some((value) => value === 'waiter:mine:7'), false);
});
