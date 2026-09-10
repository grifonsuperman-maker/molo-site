require('reflect-metadata');

const assert = require('node:assert/strict');
const test = require('node:test');
const { ValidationPipe } = require('@nestjs/common');
const { CreateBookingDto } = require('../dist/bookings/dto/create-booking.dto');
const { CreateAdminManualBookingDto } = require('../dist/bookings/dto/create-admin-manual-booking.dto');
const { UpdateClientDto } = require('../dist/clients/dto/update-client.dto');
const { GUEST_NAME_ERROR, GUEST_PHONE_ERROR } = require('../dist/common/validation/guest-contact');
const { BookingsService } = require('../dist/bookings/bookings.service');

const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const booking = {
  tableId: 'table-1', fullName: 'Олена Коваль', phone: '+380501234567',
  guestDeviceId: 'device-1', bookingDate: '2026-09-20', bookingTime: '18:00', guestsCount: 2,
};
const { guestDeviceId, ...manualBooking } = booking;
const validate = (type, value) => pipe.transform(value, { type: 'body', metatype: type });
const rejectsField = (type, value, message) => assert.rejects(
  validate(type, value),
  (error) => error.getStatus() === 400 && error.getResponse().message.includes(message),
);

test('guest and manual booking accept the same complete Ukrainian phone formats', async () => {
  for (const phone of ['+380501234567', '+380 (50) 123-45-67', '380 50 123 45 67', '0501234567', '(050) 123-45-67', '+380441234567']) {
    const expected = phone.includes('44') ? '+380441234567' : '+380501234567';
    for (const [type, base] of [[CreateBookingDto, booking], [CreateAdminManualBookingDto, manualBooking], [UpdateClientDto, {}]]) {
      const result = await validate(type, { ...base, phone });
      assert.equal(result.phone, expected, `${type.name}: ${phone}`);
    }
  }
});

test('guest phone is required, including empty strings and country prefix without subscriber digits', async () => {
  for (const phone of [undefined, null, '', '   ', '+380', '+380 (50)', '+38050123456']) {
    await rejectsField(CreateBookingDto, { ...booking, phone }, GUEST_PHONE_ERROR);
  }
});

test('manual booking keeps phone optional and never invents a client phone', async () => {
  for (const phone of [undefined, null, '', '   ']) {
    const result = await validate(CreateAdminManualBookingDto, { ...manualBooking, phone });
    assert.ok(result.phone == null);
    assert.equal(result.fullName, 'Олена Коваль');
    assert.equal('guestDeviceId' in result, false);
  }
});

test('invalid provided phone is rejected on every guest contact write, including manual booking', async () => {
  for (const phone of ['abc', '+380501234567abc', '+3805012345678', '+48501234567', '+0501234567', '+380000000000', '050123456', '05012345678', '+380 (50) 123-45-67 доб. 1', '+380+501234567', '+380501234567🙂', 380501234567, {}, [], true]) {
    for (const [type, base] of [[CreateBookingDto, booking], [CreateAdminManualBookingDto, manualBooking], [UpdateClientDto, {}]]) {
      await rejectsField(type, { ...base, phone }, GUEST_PHONE_ERROR);
    }
  }
});

test('names accept letters in different alphabets and normalize surrounding/repeated spaces', async () => {
  for (const fullName of ['Олена', 'Ілля Євген Ґалаґан', 'Саня', 'Anne Marie', 'José', 'Jose\u0301', '李 明', '  Олена   Коваль  ']) {
    for (const [type, base] of [[CreateBookingDto, booking], [CreateAdminManualBookingDto, manualBooking], [UpdateClientDto, {}]]) {
      const result = await validate(type, { ...base, fullName });
      assert.equal(result.fullName, fullName.normalize('NFC').trim().replace(/ +/g, ' '));
    }
  }
});

test('names reject digits, punctuation, emoji, blank text and overlong input at the API boundary', async () => {
  for (const fullName of ['', '   ', 'Олена123', '123', 'Олена🙂', '<script>', 'Олена_Коваль', 'Анна-Марія', 'Мар’яна', 'Олена\nКоваль', 'Олена\tКоваль', 'А'.repeat(101), 123, {}, []]) {
    for (const [type, base] of [[CreateBookingDto, booking], [CreateAdminManualBookingDto, manualBooking], [UpdateClientDto, {}]]) {
      await rejectsField(type, { ...base, fullName }, GUEST_NAME_ERROR);
    }
  }
  for (const fullName of [undefined, null]) {
    await rejectsField(CreateBookingDto, { ...booking, fullName }, GUEST_NAME_ERROR);
    await rejectsField(CreateAdminManualBookingDto, { ...manualBooking, fullName }, GUEST_NAME_ERROR);
  }
});

test('editing other client fields does not require resubmitting historical contact data', async () => {
  const result = await validate(UpdateClientDto, { note: 'Постійний гість', isRegular: true });
  assert.equal(result.note, 'Постійний гість');
  assert.equal(result.fullName, undefined);
  assert.equal(result.phone, undefined);
});

function serviceWithActiveBookings(activeBookings) {
  const query = {
    leftJoinAndSelect() { return this; }, addSelect() { return this; },
    where(_sql, { bookingDate }) { this.bookingDate = bookingDate; return this; },
    andWhere(_sql, { statuses }) { this.statuses = statuses; return this; },
    async getMany() { return activeBookings.filter((b) => b.bookingDate === this.bookingDate && this.statuses.includes(b.status)); },
  };
  return new BookingsService({ createQueryBuilder: () => query }, {}, {}, {}, {}, {}, {}, {}, {});
}

test('canonical phone still finds active bookings with historical local/formatted phone values', async () => {
  for (const storedPhone of ['0501234567', '+380 (50) 123-45-67']) {
    const service = serviceWithActiveBookings([{ bookingDate: booking.bookingDate, status: 'approved', client: { phone: storedPhone }, guestDeviceIdHash: 'old-device' }]);
    await assert.rejects(service.assertNoActiveGuestBooking(booking.bookingDate, booking.phone, 'new-device'), /активне бронювання/);
    await assert.rejects(service.assertNoActivePhoneBooking(booking.bookingDate, booking.phone), /активне бронювання/);
  }
});

test('device duplicate protection, other dates and rebooking after terminal states are preserved', async () => {
  const active = { bookingDate: booking.bookingDate, status: 'pending', client: { phone: '+380671234567' }, guestDeviceIdHash: 'same-device' };
  const service = serviceWithActiveBookings([active]);
  await assert.rejects(service.assertNoActiveGuestBooking(booking.bookingDate, booking.phone, 'same-device'), /активне бронювання/);
  await service.assertNoActiveGuestBooking('2026-09-21', booking.phone, 'same-device');
  for (const status of ['cancelled', 'rejected', 'completed', 'no-show']) {
    active.status = status;
    await service.assertNoActiveGuestBooking(booking.bookingDate, booking.phone, 'same-device');
  }
});

test('guest creation checks every matching historical client for blacklist before creating anything', async () => {
  let saved = 0;
  const clients = {
    createQueryBuilder() {
      return {
        where(sql, values) {
          assert.match(sql, /regexp_replace/);
          assert.deepEqual(values, { normalizedPhone: '380501234567', localPhone: '0501234567' });
          return this;
        },
        async getMany() { return [{ isBlacklisted: false }, { isBlacklisted: true }]; },
      };
    },
    async save() { saved += 1; },
  };
  const service = new BookingsService({}, {}, {}, clients, {}, {}, {}, {}, {});
  service.validateRestaurant = async () => {};
  service.assertNoActiveGuestBooking = async () => {};
  service.resolveTableForBooking = async () => ({ id: 'table-1' });
  service.assertTableCanBeBooked = async () => {};
  await assert.rejects(service.create(booking), /Бронювання з цього номера недоступне/);
  assert.equal(saved, 0);
});
