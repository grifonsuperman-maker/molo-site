require('reflect-metadata');

const assert = require('node:assert/strict');
const test = require('node:test');
const { TablesController } = require('../dist/tables/tables.controller.js');
const { TelegramWaiterMenuResolvedService } = require('../dist/telegram/telegram-waiter-menu-resolved.service.js');

const actor = { role: 'waiter', staffId: 'serhii', name: 'Сергій' };

test('site table endpoints pass the authenticated actor to guarded table service', async () => {
  const calls = [];
  const tables = {
    async setWaiterStatus(...args) { calls.push(['status', ...args]); },
    async markOccupied(...args) { calls.push(['occupied', ...args]); },
    async markCleaning(...args) { calls.push(['cleaning', ...args]); },
    async markFree(...args) { calls.push(['free', ...args]); },
  };
  const controller = new TablesController(tables);
  await controller.waiterStatus('table-8', 'occupied', { user: actor });
  await controller.occupied('table-8', { user: actor });
  await controller.cleaning('table-8', { user: actor });
  await controller.free('table-8', { user: actor });
  assert.deepEqual(calls, [
    ['status', 'table-8', 'occupied', actor],
    ['occupied', 'table-8', actor],
    ['cleaning', 'table-8', actor],
    ['free', 'table-8', actor],
  ]);
});

function menuHarness() {
  const calls = [];
  const table = { id: 'table-8', tableNumber: '8', status: 'occupied', isVisible: true, seats: 4 };
  const booking = {
    id: 'booking-8', source: 'admin_manual', status: 'approved',
    checkedInAt: new Date(), assignedWaiterId: 'serhii',
    table, client: { fullName: 'Гість' }, bookingTime: '19:00:00', guestsCount: 2,
  };
  const tables = {
    async markCleaning(id, requestActor) {
      calls.push(['cleaning', id, requestActor]);
      table.status = 'cleaning';
      return table;
    },
    async setWaiterStatus(id, status, requestActor) {
      calls.push(['status', id, status, requestActor]);
      table.status = status;
      return table;
    },
    async findAll() { return [table]; },
  };
  const telegram = { async sendMessage() {} };
  const menu = new TelegramWaiterMenuResolvedService(
    { async getToday() { return [booking]; } }, {}, tables, telegram,
    { async bookingIdsForWaiter() { return []; } },
  );
  return { menu, calls, table };
}

test('Telegram booking cleaning uses the accepting waiter identity', async () => {
  const { menu, calls, table } = menuHarness();
  assert.equal(await menu.handle('booking_cleaning', 'booking-8', 'chat', actor), true);
  assert.deepEqual(calls, [['cleaning', 'table-8', actor]]);
  assert.equal(table.status, 'cleaning');
});

test('Telegram table occupied/free use protected service with actor', async () => {
  const { menu, calls } = menuHarness();
  await menu.handle('table_free', 'table-8', 'chat', actor);
  await menu.handle('table_occupied', 'table-8', 'chat', actor);
  assert.deepEqual(calls, [
    ['status', 'table-8', 'free', actor],
    ['status', 'table-8', 'occupied', actor],
  ]);
});

test('other waiter cannot invoke an old Telegram cleaning callback', async () => {
  const { menu, calls } = menuHarness();
  await assert.rejects(
    menu.handle('booking_cleaning', 'booking-8', 'chat', { role: 'waiter', staffId: 'andrii' }),
    /Бронювання не знайдено/,
  );
  assert.deepEqual(calls, []);
});
