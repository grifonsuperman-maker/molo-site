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
  name: 'Адміністратор',
};

function kyivDate(offsetDays) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const year = Number(parts.find((part) => part.type === 'year')?.value || 1970);
  const month = Number(parts.find((part) => part.type === 'month')?.value || 1);
  const day = Number(parts.find((part) => part.type === 'day')?.value || 1);
  return new Date(Date.UTC(year, month - 1, day + offsetDays)).toISOString().slice(0, 10);
}

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

function createHarness(options = {}) {
  const calls = [];
  let persisted = false;
  const bookings = {
    async createManual(dto, actor) {
      calls.push(['createManual', dto, actor]);
      persisted = true;
      return {
        bookingId: 'booking-1',
        status: 'approved',
        bookingDate: dto.bookingDate,
        bookingTime: `${dto.bookingTime}:00`,
      };
    },
  };
  const tableLock = {
    async withCreateLock(dto, work) {
      calls.push(['lock', dto]);
      if (options.beforeLockedWork) await options.beforeLockedWork();
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
          isVisible: true,
          status: 'free',
        },
      ];
    },
  };
  const telegram = {
    async sendMessage(chatId, text, markup) {
      calls.push(['message', chatId, text, markup]);
      if (options.failReceipt && persisted && /Бронювання створено/.test(text)) {
        throw new Error('telegram unavailable');
      }
      return { ok: true };
    },
  };

  return {
    calls,
    service: new TelegramAdminBookingCreateService(
      bookings,
      tableLock,
      availability,
      tables,
      telegram,
    ),
  };
}

async function fillDraft(service, calls, bookingDate = kyivDate(1)) {
  await service.begin(42, ACTOR);
  await service.handleText(bookingDate, 42, ACTOR);
  await service.handleText('15', 42, ACTOR);
  await service.handleText('18:30', 42, ACTOR);
  await service.handleText('Тестовий гість', 42, ACTOR);
  await service.handleText('4', 42, ACTOR);
  await service.handleText('+380501234567', 42, ACTOR);
  const confirmation = lastMessage(calls);
  const confirmCallback = callbackFor(confirmation, '✅ Створити бронювання');
  assert.match(confirmCallback, /^admin:booking:create_confirm_[a-f0-9]+$/);
  return actionId(confirmCallback);
}

test('Telegram Admin creates manual booking through lock, availability and existing createManual', async () => {
  const { service, calls } = createHarness();
  const confirmAction = await fillDraft(service, calls);

  await service.handleAction(confirmAction, 42, ACTOR);

  assert.deepEqual(
    calls
      .filter((entry) => ['lock', 'availability', 'createManual'].includes(entry[0]))
      .map((entry) => entry[0]),
    ['lock', 'availability', 'createManual'],
  );

  const createCall = calls.find((entry) => entry[0] === 'createManual');
  assert.equal(createCall[1].tableId, 'table-15');
  assert.equal(createCall[1].fullName, 'Тестовий гість');
  assert.equal(createCall[1].phone, '+380501234567');
  assert.equal(createCall[1].bookingTime, '18:30');
  assert.equal(createCall[1].guestsCount, 4);
  assert.deepEqual(createCall[2], ACTOR);
  assert.equal(service.hasPendingInput('777'), false);
  assert.match(lastMessage(calls)[2], /Бронювання створено/);
});

test('Telegram Admin rejects a past date before table selection', async () => {
  const { service, calls } = createHarness();

  await service.begin(42, ACTOR);
  await service.handleText(kyivDate(-1), 42, ACTOR);

  assert.equal(calls.filter((entry) => entry[0] === 'tables').length, 0);
  assert.equal(service.hasPendingInput('777'), true);
  assert.match(lastMessage(calls)[2], /Минула дата недоступна/);
});

test('booking date is rechecked after the create lock is acquired', async () => {
  let currentDate = kyivDate(0);
  const { service, calls } = createHarness({
    beforeLockedWork: async () => {
      currentDate = '2099-01-01';
    },
  });
  service.kyivDate = () => currentDate;

  const confirmAction = await fillDraft(service, calls, currentDate);
  await service.handleAction(confirmAction, 42, ACTOR);

  assert.equal(calls.filter((entry) => entry[0] === 'lock').length, 1);
  assert.equal(calls.filter((entry) => entry[0] === 'availability').length, 0);
  assert.equal(calls.filter((entry) => entry[0] === 'createManual').length, 0);
  assert.match(lastMessage(calls)[2], /Дата бронювання вже минула/);
});

test('Telegram receipt failure after persistence does not offer persistence retry', async () => {
  const { service, calls } = createHarness({ failReceipt: true });
  const confirmAction = await fillDraft(service, calls);

  const originalConsoleError = console.error;
  const errors = [];
  console.error = (...args) => errors.push(args);
  try {
    await service.handleAction(confirmAction, 42, ACTOR);
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(calls.filter((entry) => entry[0] === 'createManual').length, 1);
  assert.equal(
    calls.some(
      (entry) => entry[0] === 'message' && /Бронювання не створено|Дані не збережено/.test(entry[2]),
    ),
    false,
  );
  assert.equal(errors.length, 1);

  await assert.rejects(
    () => service.handleAction(confirmAction, 42, ACTOR),
    /неактуальна/,
  );
  assert.equal(calls.filter((entry) => entry[0] === 'createManual').length, 1);
});
