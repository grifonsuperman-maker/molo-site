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

function createService() {
  const calls = [];
  const restaurant = {
    async getRestaurant() {
      return {
        status: 'open',
        adminCanManageOnlineBooking: true,
        adminCanManageRestaurant: true,
      };
    },
    async adminOpenRestaurant() { calls.push(['admin-open-restaurant']); },
    async adminCloseRestaurant() { calls.push(['admin-close-restaurant']); },
    async adminOpenBooking() { calls.push(['admin-open-booking']); },
    async adminCloseBooking() { calls.push(['admin-close-booking']); },
  };
  const telegram = {
    async sendMessage() {
      calls.push(['message']);
      throw new Error('temporary Telegram send failure');
    },
  };

  return {
    calls,
    service: new TelegramAdminMenuService(
      {},
      {},
      {},
      {},
      {},
      restaurant,
      {},
      telegram,
    ),
  };
}

test('Admin restaurant mutations stay successful when Telegram refresh fails', async () => {
  const cases = [
    ['restaurant_open', 'admin-open-restaurant'],
    ['booking_open', 'admin-open-booking'],
    ['booking_close', 'admin-close-booking'],
    ['restaurant_close', 'admin-close-restaurant'],
  ];

  for (const [action, expectedMutation] of cases) {
    const { service, calls } = createService();

    const handled = await service.handle(action, undefined, 42, ACTOR);

    assert.equal(handled, true, `${action} should remain handled`);
    assert.equal(
      calls.filter((entry) => entry[0] === expectedMutation).length,
      1,
      `${action} should mutate exactly once`,
    );
  }
});
