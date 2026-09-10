require('reflect-metadata');

const assert = require('node:assert/strict');
const test = require('node:test');
const { plainToInstance } = require('class-transformer');
const { validate } = require('class-validator');

const { CreateBookingDto } = require('../dist/bookings/dto/create-booking.dto.js');
const { CreateAdminManualBookingDto } = require('../dist/bookings/dto/create-admin-manual-booking.dto.js');

function guestPayload(overrides = {}) {
  return {
    tableId: 'table-1',
    fullName: 'Анна Марія',
    phone: '+380 (67) 123-45-67',
    guestDeviceId: 'guest-device-1',
    bookingDate: '2026-09-10',
    bookingTime: '18:00',
    guestsCount: 2,
    ...overrides,
  };
}

function manualPayload(overrides = {}) {
  return {
    tableId: 'table-1',
    fullName: 'Анна-Марія',
    bookingDate: '2026-09-10',
    bookingTime: '18:00',
    guestsCount: 2,
    ...overrides,
  };
}

test('guest booking normalizes Ukrainian phone and accepts letter-only guest name', async () => {
  const dto = plainToInstance(CreateBookingDto, guestPayload());
  const errors = await validate(dto);

  assert.deepEqual(errors, []);
  assert.equal(dto.fullName, 'Анна Марія');
  assert.equal(dto.phone, '+380671234567');
});

test('guest booking rejects digits in guest name', async () => {
  const dto = plainToInstance(CreateBookingDto, guestPayload({ fullName: 'Анна123' }));
  const errors = await validate(dto);

  assert.ok(errors.some((error) => error.property === 'fullName'));
});

test('guest booking rejects incomplete or non-Ukrainian phone', async () => {
  for (const phone of ['+380 (67) 123-45', '+48 501 234 567', 'hello']) {
    const dto = plainToInstance(CreateBookingDto, guestPayload({ phone }));
    const errors = await validate(dto);
    assert.ok(errors.some((error) => error.property === 'phone'), phone);
  }
});

test('manual admin booking accepts missing phone', async () => {
  const dto = plainToInstance(CreateAdminManualBookingDto, manualPayload());
  const errors = await validate(dto);

  assert.deepEqual(errors, []);
  assert.equal(dto.phone, undefined);
});

test('manual admin booking validates phone when it is provided', async () => {
  const valid = plainToInstance(
    CreateAdminManualBookingDto,
    manualPayload({ phone: '+380 (50) 111-22-33' }),
  );
  const validErrors = await validate(valid);
  assert.deepEqual(validErrors, []);
  assert.equal(valid.phone, '+380501112233');

  const invalid = plainToInstance(
    CreateAdminManualBookingDto,
    manualPayload({ phone: '+380 (50) 111' }),
  );
  const invalidErrors = await validate(invalid);
  assert.ok(invalidErrors.some((error) => error.property === 'phone'));
});
