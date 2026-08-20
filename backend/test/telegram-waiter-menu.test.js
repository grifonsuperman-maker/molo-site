const assert = require('node:assert/strict');
const test = require('node:test');

const {
  TelegramWaiterMenuService,
} = require('../dist/telegram/telegram-waiter-menu.service.js');
const {
  TelegramWebhookService,
} = require('../dist/telegram/telegram-webhook.service.js');

const waiterActor = {
  sub: 'waiter-1',
  telegramId: '123',
  role: 'waiter',
  staffId: 'waiter-1',
  name: 'Олександр',
};

function waiterMenuHarness() {
  const messages = [];
  const calls = [];
  const booking = {
    id: 'booking-1',
    status: 'approved',
    bookingDate: '2099-01-01',
    bookingTime: '21:00:00',
    guestsCount: 2,
    checkedInAt: null,
    table: {
      id: 'table-8',
      tableNumber: '8',
      seats: 6,
      status: 'reserved',
      isVisible: true,
      zone: { name: 'Зал ресторану' },
    },
    client: { fullName: 'Гість' },
  };
  const table = booking.table;

  const bookings = {
    async getToday() {
      return [booking];
    },
    async checkIn(id, actor) {
      calls.push(['checkin', id, actor]);
      booking.checkedInAt = new Date();
      table.status = 'occupied';
      return { message: 'ok' };
    },
    async complete(id, actor) {
      calls.push(['complete', id, actor]);
      booking.status = 'completed';
      table.status = 'free';
      return { message: 'ok' };
    },
  };
  const waiterCalls = {
    async list() {
      return [];
    },
    async myAssignments() {
      return [];
    },
    async assign(payload) {
      calls.push(['assign', payload]);
      return { message: 'ok' };
    },
    async accept(id, actor) {
      calls.push(['accept-call', id, actor]);
    },
    async close(id, waiterId) {
      calls.push(['close-call', id, waiterId]);
    },
  };
  const tables = {
    async findAll() {
      return [table];
    },
    async markCleaning(id) {
      calls.push(['cleaning', id]);
      table.status = 'cleaning';
      return table;
    },
    async setWaiterStatus(id, status) {
      calls.push(['waiter-table-status', id, status]);
      table.status = status;
      return table;
    },
  };
  const telegram = {
    async sendMessage(chatId, text, replyMarkup) {
      messages.push({ chatId, text, replyMarkup });
      return { ok: true };
    },
  };

  return {
    service: new TelegramWaiterMenuService(
      bookings,
      waiterCalls,
      tables,
      telegram,
    ),
    booking,
    table,
    messages,
    calls,
  };
}

function callback(data) {
  return {
    id: 'callback-1',
    from: { id: 123 },
    message: { chat: { id: 999 } },
    data,
  };
}

test('waiter Telegram menu mirrors waiter sections without admin booking buttons', async () => {
  const { service, messages } = waiterMenuHarness();

  await service.sendMenu(999, 'https://molo.example/#waiter');

  const keyboard = messages[0].replyMarkup.inline_keyboard.flat();
  const texts = keyboard.map((button) => button.text);
  const callbackData = keyboard.map((button) => button.callback_data).filter(Boolean);

  assert.equal(texts.includes('🔔 Виклики'), true);
  assert.equal(texts.includes('🪑 Мої столи'), true);
  assert.equal(texts.includes('📋 Усі бронювання'), true);
  assert.equal(texts.includes('🧾 Історія'), true);
  assert.equal(texts.includes('🪑 Столи без бронювання'), true);
  assert.equal(texts.includes('📱 Відкрити повний пульт'), true);
  assert.equal(callbackData.some((value) => /approve|reject/.test(value)), false);
});

test('waiter booking buttons follow the same arrived-cleaning-ready sequence as the site', async () => {
  const { service, booking, table, messages, calls } = waiterMenuHarness();

  await service.handle('booking', booking.id, 999, waiterActor);
  let keyboard = messages.at(-1).replyMarkup.inline_keyboard.flat();
  assert.equal(
    keyboard.some((button) => button.callback_data === `waiter:booking_checkin:${booking.id}`),
    true,
  );

  await service.handle('booking_checkin', booking.id, 999, waiterActor);
  assert.equal(calls.some((entry) => entry[0] === 'checkin'), true);
  assert.equal(calls.some((entry) => entry[0] === 'assign'), true);
  assert.equal(table.status, 'occupied');
  keyboard = messages.at(-1).replyMarkup.inline_keyboard.flat();
  assert.equal(
    keyboard.some((button) => button.callback_data === `waiter:booking_cleaning:${booking.id}`),
    true,
  );

  await service.handle('booking_cleaning', booking.id, 999, waiterActor);
  assert.equal(calls.some((entry) => entry[0] === 'cleaning'), true);
  assert.equal(table.status, 'cleaning');
  keyboard = messages.at(-1).replyMarkup.inline_keyboard.flat();
  assert.equal(
    keyboard.some((button) => button.callback_data === `waiter:booking_complete:${booking.id}`),
    true,
  );

  await service.handle('booking_complete', booking.id, 999, waiterActor);
  assert.equal(calls.some((entry) => entry[0] === 'complete'), true);
  assert.equal(booking.status, 'completed');
  assert.equal(table.status, 'free');
});

test('waiter walk-in table buttons use the existing waiter occupied/free rule', async () => {
  const { service, table, calls } = waiterMenuHarness();

  await service.handle('table_occupied', table.id, 999, waiterActor);
  await service.handle('table_free', table.id, 999, waiterActor);

  assert.deepEqual(
    calls.filter((entry) => entry[0] === 'waiter-table-status'),
    [
      ['waiter-table-status', table.id, 'occupied'],
      ['waiter-table-status', table.id, 'free'],
    ],
  );
});

test('new waiter Telegram callbacks require a linked waiter on an active shift', async () => {
  const delegated = [];
  const telegram = {
    async answerCallbackQuery() {
      return { ok: true };
    },
    async sendMessage() {
      return { ok: true };
    },
  };
  const waiterMenu = {
    async handle(action, id, chatId, actor) {
      delegated.push({ action, id, chatId, actor });
      return true;
    },
  };
  const baseMocks = [{}, {}, {}, telegram];

  const onShiftStaff = {
    id: 'waiter-1',
    fullName: 'Олександр',
    role: 'waiter',
    active: true,
    isArchived: false,
    isOnShift: true,
  };
  const onShiftService = new TelegramWebhookService(
    ...baseMocks,
    { async findActiveStaffByTelegramId() { return onShiftStaff; } },
    waiterMenu,
  );
  assert.deepEqual(
    await onShiftService.handleCallback(callback('waiter:tables')),
    { ok: true },
  );
  assert.equal(delegated.length, 1);
  assert.equal(delegated[0].actor.role, 'waiter');

  const offShiftService = new TelegramWebhookService(
    ...baseMocks,
    {
      async findActiveStaffByTelegramId() {
        return { ...onShiftStaff, isOnShift: false };
      },
    },
    waiterMenu,
  );
  assert.deepEqual(
    await offShiftService.handleCallback(callback('waiter:tables')),
    { ok: false },
  );
  assert.equal(delegated.length, 1);

  const hookahService = new TelegramWebhookService(
    ...baseMocks,
    {
      async findActiveStaffByTelegramId() {
        return { ...onShiftStaff, role: 'hookah' };
      },
    },
    waiterMenu,
  );
  assert.deepEqual(
    await hookahService.handleCallback(callback('waiter:tables')),
    { ok: false },
  );
  assert.equal(delegated.length, 1);
});
