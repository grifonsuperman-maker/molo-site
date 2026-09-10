require('reflect-metadata');

const assert = require('node:assert/strict');
const test = require('node:test');
const { plainToInstance } = require('class-transformer');
const { validate } = require('class-validator');

const { CreateBookingDto } = require('../dist/bookings/dto/create-booking.dto.js');
const { CreateAdminManualBookingDto } = require('../dist/bookings/dto/create-admin-manual-booking.dto.js');
const {
  normalizeLegacyUkrainePhone,
  ukrainePhoneDigitsVariants,
} = require('../dist/bookings/guest-contact-validation.js');

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
    fullName: 'Анна Марія',
    bookingDate: '2026-09-10',
    bookingTime: '18:00',
    guestsCount: 2,
    ...overrides,
  };
}

test('guest booking normalizes Ukrainian phone and accepts letters with spaces', async () => {
  const dto = plainToInstance(CreateBookingDto, guestPayload());
  const errors = await validate(dto);

  assert.deepEqual(errors, []);
  assert.equal(dto.fullName, 'Анна Марія');
  assert.equal(dto.phone, '+380671234567');
});

test('guest booking rejects digits, hyphen and apostrophe in guest name', async () => {
  for (const fullName of ['Анна123', 'Анна-Марія', 'О’Браєн']) {
    const dto = plainToInstance(CreateBookingDto, guestPayload({ fullName }));
    const errors = await validate(dto);
    assert.ok(errors.some((error) => error.property === 'fullName'), fullName);
  }
});

test('guest booking rejects incomplete, legacy-only or non-Ukrainian phone input', async () => {
  for (const phone of [
    '+380 (67) 123-45',
    '+3806712345678',
    '501234567',
    '+48 501 234 567',
    '+380 (01) 123-45-67',
    'hello',
  ]) {
    const dto = plainToInstance(CreateBookingDto, guestPayload({ phone }));
    const errors = await validate(dto);
    assert.ok(errors.some((error) => error.property === 'phone'), phone);
  }
});

test('legacy Ukrainian phone formats resolve to one canonical identity', () => {
  for (const phone of ['501234567', '0501234567', '+380501234567', '+380 (50) 123-45-67']) {
    assert.equal(normalizeLegacyUkrainePhone(phone), '+380501234567', phone);
  }
  assert.deepEqual(
    ukrainePhoneDigitsVariants('+380 (50) 123-45-67'),
    ['380501234567', '0501234567', '501234567'],
  );
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
