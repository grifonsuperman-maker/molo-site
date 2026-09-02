const assert = require('node:assert/strict');
const test = require('node:test');

const {
  TelegramAdminMenuBookingFacadeService,
} = require('../dist/telegram/telegram-admin-menu-booking-facade.service.js');

const ACTOR = {
  sub: 'admin-1',
  telegramId: '777',
  role: 'admin',
  staffId: 'admin-1',
  name: 'Адміністратор',
};

test('facade keeps existing admin menu behavior and adds booking entry', async () => {
  const calls = [];
  const baseMenu = {
    hasPendingInput() {
      return false;
    },
    clearPendingInput(id) {
      calls.push(['base-clear', id]);
    },
    async sendMenu(chatId, actor, appUrl) {
      calls.push(['base-menu', chatId, actor, appUrl]);
    },
    async handle(action, id, chatId, actor, appUrl) {
      calls.push(['base-handle', action, id, chatId, actor, appUrl]);
      return 'base-result';
    },
    async handleText(text, chatId, actor) {
      calls.push(['base-text', text, chatId, actor]);
      return true;
    },
  };
  const bookingCreate = {
    hasPendingInput() {
      return false;
    },
    clearPendingInput(id) {
      calls.push(['booking-clear', id]);
    },
    async sendEntry(chatId) {
      calls.push(['booking-entry', chatId]);
    },
    async handleAction(id, chatId, actor) {
      calls.push(['booking-action', id, chatId, actor]);
      return true;
    },
    async handleText(text, chatId, actor) {
      calls.push(['booking-text', text, chatId, actor]);
      return true;
    },
  };

  const facade = new TelegramAdminMenuBookingFacadeService(baseMenu, bookingCreate);
  await facade.sendMenu(42, ACTOR, 'https://example.test/admin');

  assert.deepEqual(calls.slice(0, 2).map((entry) => entry[0]), [
    'base-menu',
    'booking-entry',
  ]);

  const regularResult = await facade.handle(
    'booking',
    'existing-booking-id',
    42,
    ACTOR,
    'https://example.test/admin',
  );
  assert.equal(regularResult, 'base-result');
  assert.equal(calls.some((entry) => entry[0] === 'booking-action'), false);

  await facade.handle('booking', 'create', 42, ACTOR);
  assert.equal(
    calls.some(
      (entry) =>
        entry[0] === 'booking-action' && entry[1] === 'create' && entry[2] === 42,
    ),
    true,
  );
});

test('facade routes pending booking text before existing broadcast text handling', async () => {
  const calls = [];
  const baseMenu = {
    hasPendingInput() {
      return true;
    },
    clearPendingInput() {},
    async sendMenu() {},
    async handle() {
      return false;
    },
    async handleText() {
      calls.push(['base-text']);
      return true;
    },
  };
  const bookingCreate = {
    hasPendingInput(id) {
      return id === '777';
    },
    clearPendingInput() {},
    async sendEntry() {},
    async handleAction() {
      return true;
    },
    async handleText(text, chatId, actor) {
      calls.push(['booking-text', text, chatId, actor]);
      return true;
    },
  };

  const facade = new TelegramAdminMenuBookingFacadeService(baseMenu, bookingCreate);
  const handled = await facade.handleText('15', 42, ACTOR);

  assert.equal(handled, true);
  assert.deepEqual(calls.map((entry) => entry[0]), ['booking-text']);
});
