from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file_path = Path(path)
    text = file_path.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"Expected exactly one match in {path}, found {count}")
    file_path.write_text(text.replace(old, new, 1))


notifications_path = "backend/src/notifications/notifications.service.ts"
notifications_anchor = """  async notifyBookingApproved(booking: Booking) {\n"""
notifications_method = """  async notifyManualBookingCreated(booking: Booking) {\n    const longBookingLine = this.isLongBooking(booking) ? '⚠️ <b>Довге бронювання</b>' : null;\n\n    const text = [\n      '🟠 <b>Нове бронювання</b>',\n      '✍️ Створено Адміністратором',\n      '',\n      `🪑 Стіл: <b>${booking.table?.tableNumber || '-'}</b>`,\n      `👤 Імʼя: <b>${booking.client?.fullName || '-'}</b>`,\n      `📞 Телефон: <b>${booking.client?.phone || '-'}</b>`,\n      `📅 Дата: <b>${booking.bookingDate}</b>`,\n      `🕒 Час: <b>${this.bookingTimeRange(booking)}</b>`,\n      `⏳ Відпочинок: <b>${this.durationLine(booking)}</b>`,\n      `🧽 Наступний гість з: <b>${this.availableFromLabel(booking)}</b>`,\n      longBookingLine,\n      `👥 Гостей: <b>${booking.guestsCount}</b>`,\n      `📝 Побажання: ${booking.wishes || '-'}`,\n    ].filter(Boolean).join('\\n');\n\n    await this.sendToRoles(['waiter'], text);\n  }\n\n  async notifyBookingApproved(booking: Booking) {\n"""
replace_once(notifications_path, notifications_anchor, notifications_method)

bookings_path = "backend/src/bookings/bookings.service.ts"
bookings_anchor = """      await this.safeLog('Створено ручне бронювання', {\n        bookingId: booking.id,\n        tableNumber: table.tableNumber,\n        clientName: client.fullName,\n        bookingDate,\n        time: `${timeInfo.bookingTimeLabel} — ${timeInfo.departureTimeLabel}`,\n        durationMinutes: timeInfo.durationMinutes,\n        source: 'admin_manual',\n        actorRole: actor?.role || null,\n        actorStaffId: actor?.staffId || null,\n        actorName: actor?.name || null,\n      });\n\n      return {\n"""
bookings_replacement = """      await this.safeLog('Створено ручне бронювання', {\n        bookingId: booking.id,\n        tableNumber: table.tableNumber,\n        clientName: client.fullName,\n        bookingDate,\n        time: `${timeInfo.bookingTimeLabel} — ${timeInfo.departureTimeLabel}`,\n        durationMinutes: timeInfo.durationMinutes,\n        source: 'admin_manual',\n        actorRole: actor?.role || null,\n        actorStaffId: actor?.staffId || null,\n        actorName: actor?.name || null,\n      });\n\n      await this.safeNotify(async () => {\n        const full = await this.bookings.findOne({\n          where: { id: booking.id },\n          relations: ['table', 'client'],\n        });\n        if (full) await this.notifications.notifyManualBookingCreated(full);\n      });\n\n      return {\n"""
replace_once(bookings_path, bookings_anchor, bookings_replacement)

telegram_test_path = "backend/test/telegram-booking-notifications.test.js"
telegram_test_anchor = """test('Director is excluded from operational Telegram notifications', async () => {\n"""
telegram_test_new = """test('manual Admin booking notification goes only to waiter without approval buttons', async () => {\n  const { service } = createNotificationsService();\n  const deliveries = [];\n\n  service.sendToRoles = async (roles, text, replyMarkup) => {\n    deliveries.push({ roles, text, replyMarkup });\n    return { attempted: 1, delivered: 1, failed: 0 };\n  };\n\n  await service.notifyManualBookingCreated(booking);\n\n  assert.equal(deliveries.length, 1);\n  assert.deepEqual(deliveries[0].roles, ['waiter']);\n  assert.equal(deliveries[0].replyMarkup, undefined);\n  assert.match(deliveries[0].text, /Нове бронювання/);\n  assert.match(deliveries[0].text, /Створено Адміністратором/);\n  assert.match(deliveries[0].text, /Дата: <b>2026-08-16<\\/b>/);\n  assert.deepEqual(callbacks(deliveries[0].replyMarkup), []);\n});\n\ntest('Director is excluded from operational Telegram notifications', async () => {\n"""
replace_once(telegram_test_path, telegram_test_anchor, telegram_test_new)

manual_test_path = "backend/test/admin-manual-booking.test.js"
manual_test_anchor_1 = """test('manual booking is saved approved without guest browser credentials', async () => {\n  const saved = [];\n  const histories = [];\n  const tableStatus = [];\n"""
manual_test_new_1 = """test('manual booking is saved approved without guest browser credentials', async () => {\n  const saved = [];\n  const histories = [];\n  const tableStatus = [];\n  const waiterNotifications = [];\n"""
replace_once(manual_test_path, manual_test_anchor_1, manual_test_new_1)

manual_test_anchor_2 = """  const bookings = {\n    create(value) {\n      return { id: 'booking-1', ...value };\n    },\n    async save(value) {\n      saved.push(value);\n      return value;\n    },\n  };\n"""
manual_test_new_2 = """  const bookings = {\n    create(value) {\n      return { id: 'booking-1', ...value };\n    },\n    async save(value) {\n      saved.push(value);\n      return value;\n    },\n    async findOne() {\n      return saved[0] || null;\n    },\n  };\n"""
replace_once(manual_test_path, manual_test_anchor_2, manual_test_new_2)

manual_test_anchor_3 = """    { create: async () => undefined },\n    {},\n    {},\n  );\n"""
manual_test_new_3 = """    { create: async () => undefined },\n    {\n      async notifyManualBookingCreated(value) {\n        waiterNotifications.push(value);\n      },\n    },\n    {},\n  );\n"""
replace_once(manual_test_path, manual_test_anchor_3, manual_test_new_3)

manual_test_anchor_4 = """  assert.equal(tableStatus[0][1], 'reserved');\n  assert.equal(tableStatus[0][2], '2026-09-10');\n});\n"""
manual_test_new_4 = """  assert.equal(tableStatus[0][1], 'reserved');\n  assert.equal(tableStatus[0][2], '2026-09-10');\n  assert.equal(waiterNotifications.length, 1);\n  assert.equal(waiterNotifications[0].id, 'booking-1');\n  assert.equal(waiterNotifications[0].status, 'approved');\n  assert.equal(waiterNotifications[0].source, 'admin_manual');\n});\n"""
replace_once(manual_test_path, manual_test_anchor_4, manual_test_new_4)

print('Admin manual waiter Telegram patch applied')
