const assert = require('node:assert/strict');
const test = require('node:test');

const { BookingsController } = require('../dist/bookings/bookings.controller.js');

function buildController({ blacklistedClients = [], requestResult } = {}) {
  const service = {
    create: async () => ({ message: 'created' }),
  };
  const guestService = {
    changeTable: async () => {
      throw new Error('Пряма зміна столу не повинна викликатися');
    },
  };
  const guestRequests = {
    requestTableChange: async (id, token, dto) =>
      requestResult || { id, token, dto, message: 'requested' },
  };
  const tableLock = {
    withCreateLock: async (_dto, callback) => callback(),
  };
  const availabilityBlocks = {
    assertBookable: async () => undefined,
  };
  const rescheduleApproval = {};
  const dataSource = {
    getRepository: () => ({
      find: async () => blacklistedClients,
    }),
  };
  const notifications = {};

  return new BookingsController(
    service,
    guestService,
    guestRequests,
    tableLock,
    availabilityBlocks,
    rescheduleApproval,
    dataSource,
    notifications,
  );
}

test('blacklist blocks the same phone with different formatting', async () => {
  const controller = buildController({
    blacklistedClients: [{ phone: '+38 (067) 123-45-67' }],
  });

  await assert.rejects(
    () =>
      controller.create({
        phone: '0671234567',
        tableId: 'table-id',
        fullName: 'Гість',
        guestDeviceId: 'device',
        bookingDate: '2026-07-25',
        bookingTime: '19:00',
        guestsCount: 2,
      }),
    (error) =>
      typeof error?.getStatus === 'function' &&
      error.getStatus() === 400 &&
      error.message === 'Бронювання з цього номера недоступне',
  );
});

test('guest table change creates an administrator request instead of moving booking', async () => {
  const expected = { message: 'Запит створено' };
  const controller = buildController({ requestResult: expected });

  const result = await controller.guestChangeTable(
    'booking-id',
    'guest-token',
    { tableNumber: '18' },
  );

  assert.equal(result, expected);
});
