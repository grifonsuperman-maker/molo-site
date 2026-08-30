const assert = require('node:assert/strict');
const test = require('node:test');

const {
  TelegramAdminBookingCreateService,
} = require('../dist/telegram/telegram-admin-booking-create.service.js');

const ACTOR = {
  sub: 'admin-1',
  telegramId: '777',
  role: 'admin',
  staffId: 'admin-1',
  name: 'Олена Адміністратор',
};

function lastMessage(calls) {
  return [...calls].reverse().find((entry) => entry[0] === 'message');
}

function callbackFor(messageCall, text) {
  const keyboard = messageCall?.[3]?.inline_keyboard || [];
  return keyboard.flat().find((button) => button.text === text)?.callback_data || null;
}

function actionId(callbackData) {
  const parts = String(callbackData || '').split(':');
  assert.equal(parts[0], 'admin');
  assert.equal(parts[1], 'booking');
  return parts[2];
}

test('Admin Telegram creates approved manual booking with optional phone skipped', async () => {
  const calls = [];
  let receivedDto = null;
  let receivedActor = null;
  const bookings = {
    async createManual(dto, actor) {
      calls.push(['createManual', dto, actor]);
      receivedDto = dto;
      receivedActor = actor;
      return {
        bookingId: 'booking-1',
        status: 'approved',
        bookingDate: dto.bookingDate,
        bookingTime: '18:30:00',
        departureTime: '20:30:00',
        availableFrom: '20:45:00',
        durationMinutes: 120,
        cleanupMinutes: 15,
      };
    },
  };
  const tableLock = {
    async withCreateLock(dto, work) {
      calls.push(['lock', dto]);
      return work();
    },
  };
  const availability = {
    async assertBookable(dto) {
      calls.push(['availability', dto]);
    },
  };
  const tables = {
    async findAll() {
      calls.push(['tables']);
      return [
        {
          id: 'table-15',
          tableNumber: '15',
          seats: 6,
          isVisible: true,
          status: 'free',
        },
      ];
    },
  };
  const telegram = {
    async sendMessage(chatId, text, markup) {
      calls.push(['message', chatId, text, markup]);
      return { ok: true };
    },
  };
  const service = new TelegramAdminBookingCreateService(
    bookings,
    tableLock,
    availability,
    tables,
    telegram,
  );

  await service.begin(42, ACTOR);
  assert.equal(service.hasPendingInput('777'), true);

  await service.handleText('2026-09-10', 42, ACTOR);
  await service.handleText('15', 42, ACTOR);
  await service.handleText('18:30', 42, ACTOR);
  await service.handleText('Гість без телефону', 42, ACTOR);
  await service.handleText('4', 42, ACTOR);

  const skipCallback = callbackFor(lastMessage(calls), '⏭ Пропустити телефон');
  assert.match(skipCallback, /^admin:booking:create_skip_phone_[a-z0-9]+$/);
  await service.handleAction(actionId(skipCallback), 42, ACTOR);

  const confirmation = lastMessage(calls);
  assert.match(confirmation[2], /Телефон|📞/);
  assert.match(confirmation[2], /не вказано/);
  const confirmCallback = callbackFor(confirmation, '✅ Створити бронювання');
  assert.match(confirmCallback, /^admin:booking:create_confirm_[a-z0-9]+$/);

  await service.handleAction(actionId(confirmCallback), 42, ACTOR);

  assert.deepEqual(
    calls
      .filter((entry) => ['lock', 'availability', 'createManual'].includes(entry[0]))
      .map((entry) => entry[0]),
    ['lock', 'availability', 'createManual'],
  );
  assert.equal(Object.prototype.hasOwnProperty.call(receivedDto, 'phone'), false);
  assert.equal(receivedDto.tableId, 'table-15');
  assert.equal(receivedDto.bookingDate, '2026-09-10');
  assert.equal(receivedDto.bookingTime, '18:30');
  assert.equal(receivedDto.fullName, 'Гість без телефону');
  assert.equal(receivedDto.guestsCount, 4);
  assert.deepEqual(receivedActor, ACTOR);
  assert.equal(service.hasPendingInput('777'), false);
  assert.match(lastMessage(calls)[2], /Бронювання створено/);

  await assert.rejects(
    () => service.handleAction(actionId(confirmCallback), 42, ACTOR),
    /неактуальна/,
  );
  assert.equal(calls.filter((entry) => entry[0] === 'createManual').length, 1);
});
