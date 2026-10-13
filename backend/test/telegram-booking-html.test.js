require('reflect-metadata');

const assert = require('node:assert/strict');
const test = require('node:test');
const { NotificationsService } = require('../dist/notifications/notifications.service.js');
const { TelegramService } = require('../dist/notifications/telegram.service.js');

const booking = {
  id: 'booking-html-1',
  bookingDate: '2026-10-13',
  bookingTime: '18:30',
  guestsCount: 4,
  wishes: '',
  table: { tableNumber: '7' },
  client: { fullName: 'Марія', phone: '+380501112233' },
};

function transport(t) {
  const messages = [];
  const pushes = [];
  const telegram = new TelegramService();
  telegram.botToken = 'synthetic-test-only';
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    messages.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({ ok: true }) };
  });
  const service = new NotificationsService(
    { find: async () => [{ telegramId: 'synthetic-chat' }] },
    telegram,
    { sendBookingNotification: async (...args) => { pushes.push(args); } },
  );
  return { service, messages, pushes };
}

function assertTemplateTags(text) {
  const tags = text.match(/<[^>]*>/g) || [];
  assert.ok(tags.length > 0, 'the template keeps its own bold formatting');
  assert.ok(tags.every((tag) => tag === '<b>' || tag === '</b>'), tags.join(', '));
  assert.equal(tags.filter((tag) => tag === '<b>').length, tags.filter((tag) => tag === '</b>').length);
}

const wishesCases = [
  ['comparison symbols and Unicode', 'Тихо < 5 & тепло > 2\nПоруч із вікном 😊', 'Тихо &lt; 5 &amp; тепло &gt; 2\nПоруч із вікном 😊'],
  ['HTML link', '<a href="https://example.invalid">Підтвердити</a>', '&lt;a href="https://example.invalid"&gt;Підтвердити&lt;/a&gt;'],
  ['unclosed and closing tags', '</b><i>Біля вікна', '&lt;/b&gt;&lt;i&gt;Біля вікна'],
  ['literal entity text', '&lt;b&gt; &amp; &#60; &#x3c;', '&amp;lt;b&amp;gt; &amp;amp; &amp;#60; &amp;#x3c;'],
  ['plain wishes', 'Дитяче крісло, будь ласка', 'Дитяче крісло, будь ласка'],
  ['empty wishes', '', '-'],
  ['missing wishes', null, '-'],
];

for (const method of ['notifyNewBooking', 'notifyManualBookingCreated']) {
  test(`${method} sends guest wishes as literal Telegram HTML text`, async (t) => {
    for (const [label, wishes, expected] of wishesCases) {
      await t.test(label, async (t) => {
        const { service, messages } = transport(t);
        const input = { ...booking, wishes };
        const before = structuredClone(input);
        await service[method](input);

        assert.equal(messages.length, method === 'notifyNewBooking' ? 2 : 1);
        for (const message of messages) {
          assert.equal(message.parse_mode, 'HTML');
          assert.ok(message.text.endsWith(`📝 Побажання: ${expected}`), message.text);
          assertTemplateTags(message.text);
          assert.match(message.text, /👤 Імʼя: <b>Марія<\/b>/);
        }
        assert.deepEqual(input, before, 'escaping must not modify stored wishes or booking data');
        if (method === 'notifyNewBooking') {
          assert.deepEqual(messages[0].reply_markup.inline_keyboard[0].map((button) => button.callback_data), [
            'booking:approve:booking-html-1', 'booking:reject:booking-html-1',
          ]);
          assert.equal(messages[1].reply_markup, undefined);
        } else {
          assert.equal(messages[0].reply_markup, undefined);
          assert.match(messages[0].text, /Створено Адміністратором/);
        }
      });
    }
  });

  test(`${method} also escapes duration text extracted from legacy wishes`, async (t) => {
    const { service, messages } = transport(t);
    await service[method]({
      ...booking,
      wishes: 'Час відпочинку: 240 хв <i>Біля вікна & тихо</i>\nНаступний гість',
    });
    for (const message of messages) {
      assert.ok(message.text.includes('⏳ Відпочинок: <b>240 хв &lt;i&gt;Біля вікна &amp; тихо&lt;/i&gt;</b>'));
      assert.ok(message.text.includes('⚠️ <b>Довге бронювання</b>'));
      assertTemplateTags(message.text);
    }
  });
}

test('normal booking time, cleanup, long-booking flag and phone text stay unchanged', async (t) => {
  const { service, messages } = transport(t);
  await service.notifyNewBooking({
    ...booking,
    wishes: 'Час відпочинку: 240 хв (18:30 — 22:30)\nПідготовка столу після гостей: 15 хв, наступний гість з 22:45\nДитяче крісло',
  });
  for (const message of messages) {
    assert.ok(message.text.includes('🕒 Час: <b>18:30 — 22:30</b>'));
    assert.ok(message.text.includes('⏳ Відпочинок: <b>240 хв (18:30 — 22:30)</b>'));
    assert.ok(message.text.includes('🧽 Наступний гість з: <b>22:45</b>'));
    assert.ok(message.text.includes('⚠️ <b>Довге бронювання</b>'));
    assert.ok(message.text.includes('📞 Телефон: <b>+380501112233</b>'));
  }
});

test('other booking text fields cannot insert HTML in later Telegram notifications', async (t) => {
  const unsafeBooking = {
    ...booking,
    table: { tableNumber: '<i>7 & 8</i>' },
    client: { fullName: 'Марія & <Іван>', phone: '<i>+380501112233 &</i>' },
    bookingDate: '<i>2026-10-13 &</i>',
    bookingTime: '18:<i>',
  };
  const scenarios = [
    ['notifyNewBooking', unsafeBooking],
    ['notifyManualBookingCreated', unsafeBooking],
    ['notifyBookingApproved', unsafeBooking],
    ['notifyBookingCancelled', unsafeBooking],
    ['notifyLateGuest', unsafeBooking],
    ['notifyRescheduleRequest', {
      id: 'request-html-1', booking: unsafeBooking,
      requestedDate: '<i>2026-10-14 &</i>', requestedTime: '19:<i>',
    }],
    ['notifyGuestReportedLateness', {
      tableNumber: unsafeBooking.table.tableNumber, bookingDate: unsafeBooking.bookingDate,
      bookingTime: unsafeBooking.bookingTime, latenessHours: 0, latenessMinutes: 15,
    }],
    ['notifyGuestRescheduleDecision', {
      bookingId: booking.id, telegramId: 'synthetic-chat', decision: 'rejected',
      bookingDate: unsafeBooking.bookingDate, bookingTime: unsafeBooking.bookingTime,
      adminComment: '<a href="https://example.invalid">Причина & відповідь</a>',
    }],
  ];
  for (const [method, input] of scenarios) {
    await t.test(method, async (t) => {
      const { service, messages } = transport(t);
      await service[method](input);
      assert.ok(messages.length > 0);
      for (const message of messages) {
        assertTemplateTags(message.text);
        assert.ok(message.text.includes('&lt;i&gt;'));
        assert.ok(message.text.includes('&amp;'));
        assert.ok(!message.text.includes('&amp;amp;'), 'already escaped names/comments must not be escaped twice');
      }
    });
  }
});

test('plain Web Push text keeps literal guest and table text', async (t) => {
  const { service, pushes } = transport(t);
  await service.notifyGuestRescheduleDecision({
    bookingId: booking.id, decision: 'rejected', bookingDate: booking.bookingDate, bookingTime: booking.bookingTime,
    adminComment: 'Причина < 5 & > 2',
  });
  assert.equal(pushes.length, 1);
  assert.ok(pushes[0][1].includes('Причина < 5 & > 2'));
  assert.ok(!pushes[0][1].includes('&lt;'));
  await service.notifyBookingApproved({ ...booking, table: { tableNumber: '7 & 8 <зал>' } });
  assert.ok(pushes[1][1].includes('Стіл №7 & 8 <зал>'));
});
