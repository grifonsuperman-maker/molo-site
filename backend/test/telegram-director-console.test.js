const assert = require('node:assert/strict');
const test = require('node:test');

const {
  TelegramDirectorMenuService,
} = require('../dist/telegram/telegram-director-menu.service.js');

const ACTOR = {
  sub: 'director-1',
  staffId: 'director-1',
  telegramId: '999',
  role: 'owner',
  name: 'Директор',
};

function createFixture() {
  const messages = [];
  const restaurantState = {
    status: 'open',
    openTime: '10:00',
    bookingCloseTime: '22:00',
    closeTime: '23:00',
    adminCanManageZones: false,
    adminCanManageOnlineBooking: false,
    adminCanManageRestaurant: false,
    adminCanChangeSiteMode: false,
    adminCanEditRestaurantSettings: false,
    adminCanManageBlacklist: false,
    adminCanRespondReviews: false,
    adminCanManageStaffShifts: false,
    adminCanSendBroadcasts: false,
  };
  const restaurantCalls = [];
  const broadcastCalls = [];
  const bookings = {
    async getToday() {
      return [
        {
          id: 'booking-1', status: 'pending', bookingDate: '2026-08-22', bookingTime: '18:00', guestsCount: 4,
          table: { tableNumber: '5', zone: { name: 'Зал ресторану' } },
          client: { fullName: 'Гість Один', phone: '+380000000001' },
        },
        {
          id: 'booking-2', status: 'approved', bookingDate: '2026-08-22', bookingTime: '19:00', guestsCount: 2,
          table: { tableNumber: '16', zone: { name: 'Навіс' } },
          client: { fullName: 'Гість Два', phone: '+380000000002' },
        },
      ];
    },
    async getPendingReschedules() {
      return [{
        id: 'reschedule-1', requestedDate: '2026-08-23', requestedTime: '20:00',
        booking: {
          bookingDate: '2026-08-22', bookingTime: '18:00',
          table: { tableNumber: '5' }, client: { fullName: 'Гість Один' },
        },
      }];
    },
  };
  const broadcasts = {
    async getTargetClients() {
      return [{ id: 'client-1', telegramId: '1001' }];
    },
    async sendNow(payload) {
      broadcastCalls.push(payload);
      return { recipientCount: 1, deliveredCount: 1, unreachableCount: 0 };
    },
  };
  const restaurant = {
    async getRestaurant() { return restaurantState; },
    async update(patch) {
      restaurantCalls.push(['update', patch]);
      Object.assign(restaurantState, patch);
      return { restaurant: restaurantState };
    },
    async openRestaurant() {
      restaurantCalls.push(['open']);
      restaurantState.status = 'open';
    },
    async openBooking() {
      restaurantCalls.push(['booking-open']);
      restaurantState.status = 'open';
    },
    async closeBooking() {
      restaurantCalls.push(['booking-close']);
      restaurantState.status = 'booking_closed';
    },
    async closeRestaurant() {
      restaurantCalls.push(['close']);
      restaurantState.status = 'closed';
    },
  };
  const tables = {
    async findAll() {
      return [
        { id: 'table-1', tableNumber: '1', status: 'free', seats: 4, zone: { name: 'Зал ресторану' } },
        { id: 'table-2', tableNumber: '15', status: 'occupied', seats: 6, zone: { name: 'Навіс' } },
      ];
    },
  };
  const staff = {
    async findAll() {
      return [
        { id: 'director-1', fullName: 'Директор', role: 'owner', active: true, isArchived: false, isOnShift: false },
        { id: 'waiter-1', fullName: 'Офіціант', role: 'waiter', active: true, isArchived: false, isOnShift: true },
        { id: 'hookah-1', fullName: 'Кальянник', role: 'hookah', active: true, isArchived: false, isOnShift: true },
      ];
    },
  };
  const analytics = {
    async getToday() {
      return { date: '2026-08-22', bookingsCount: 2, pendingCount: 1, guestsCount: 6, occupiedTables: 1, freeTables: 1, closedZones: 0 };
    },
  };
  const logs = {
    async findAll() {
      return [{ id: 'log-1', action: 'Тестова дія', createdAt: '2026-08-22T09:00:00Z', staff: { fullName: 'Офіціант', role: 'waiter' } }];
    },
  };
  const telegram = {
    async sendMessage(...args) {
      messages.push(args);
      return { ok: true };
    },
  };
  const service = new TelegramDirectorMenuService(
    bookings,
    broadcasts,
    restaurant,
    tables,
    staff,
    analytics,
    logs,
    telegram,
  );
  return { service, messages, restaurantState, restaurantCalls, broadcastCalls };
}

test('Director menu shows operational counts and keeps sensitive controls in the full Mini App', async () => {
  const { service, messages } = createFixture();
  await service.sendMenu(42, ACTOR, 'https://molo.example/app#director');

  assert.equal(messages.length, 1);
  const [chatId, text, markup] = messages[0];
  assert.equal(chatId, 42);
  assert.match(text, /Пульт Директора/);
  assert.match(text, /Бронювань сьогодні: <b>2<\/b>/);
  assert.match(text, /Працівників на зміні: <b>2<\/b>/);

  const buttons = markup.inline_keyboard.flat();
  const labels = buttons.map((button) => button.text);
  assert.ok(labels.some((label) => label.startsWith('📋 Бронювання · 2')));
  assert.ok(labels.includes('👔 Права Адміністратора'));
  assert.ok(labels.includes('📣 Розсилка всім гостям'));
  assert.ok(labels.includes('📱 Відкрити повний пульт'));
  assert.equal(labels.some((label) => /Syrve|парол|Видалити/.test(label)), false);
});

test('Director booking details are read-only inside the new console', async () => {
  const { service, messages } = createFixture();
  await service.handle('booking', 'booking-1', 42, ACTOR, 'https://molo.example/app#director');

  const markup = messages.at(-1)[2];
  const callbacks = markup.inline_keyboard.flat().map((button) => button.callback_data).filter(Boolean);
  assert.deepEqual(callbacks, ['director:bookings:0']);
  assert.equal(markup.inline_keyboard.flat().some((button) => button.web_app?.url.endsWith('#director')), true);
});

test('Director permission buttons set an explicit value and repeated stale taps are idempotent', async () => {
  const { service, restaurantCalls, restaurantState } = createFixture();

  await service.handle('right_enable', 'broadcasts', 42, ACTOR);
  await service.handle('right_enable', 'broadcasts', 42, ACTOR);

  assert.equal(restaurantState.adminCanSendBroadcasts, true);
  assert.deepEqual(
    restaurantCalls.filter((call) => call[0] === 'update'),
    [['update', { adminCanSendBroadcasts: true }]],
  );
});

test('Director restaurant actions do not repeat a mutation when the state is already current', async () => {
  const { service, restaurantCalls, restaurantState } = createFixture();

  await service.handle('restaurant_close', undefined, 42, ACTOR);
  await service.handle('restaurant_close', undefined, 42, ACTOR);

  assert.equal(restaurantState.status, 'closed');
  assert.equal(restaurantCalls.filter((call) => call[0] === 'close').length, 1);
});

test('Director broadcast confirmation can deliver a draft only once', async () => {
  const { service, messages, broadcastCalls } = createFixture();

  await service.handle('broadcast', undefined, 42, ACTOR);
  await service.handleText('Повідомлення від Директора', 42, ACTOR);
  const preview = messages.at(-1)[2].inline_keyboard.flat();
  const confirm = preview.find((button) => button.text === '✅ Надіслати всім').callback_data;
  const draftId = confirm.split(':')[2];

  await service.handle('broadcast_confirm', draftId, 42, ACTOR, 'https://molo.example/app#director');
  await assert.rejects(
    () => service.handle('broadcast_confirm', draftId, 42, ACTOR, 'https://molo.example/app#director'),
    /неактуальна/,
  );

  assert.equal(broadcastCalls.length, 1);
  assert.equal(service.hasPendingInput('999'), false);
});

test('non-Director actor cannot use Director menu service', async () => {
  const { service } = createFixture();
  await assert.rejects(
    () => service.sendMenu(42, { ...ACTOR, role: 'admin' }),
    /Потрібен доступ Директора/,
  );
});
