require('reflect-metadata');

const assert = require('node:assert/strict');
const test = require('node:test');
const { BadRequestException, UnauthorizedException } = require('@nestjs/common');

const { BookingsController } = require('../dist/bookings/bookings.controller.js');
const {
  GuestTableNumberValidationService,
} = require('../dist/bookings/guest-table-number-validation.service.js');

function validationService() {
  const lookups = [];
  const tables = {
    async findOne(options) {
      const tableNumber = options?.where?.tableNumber;
      lookups.push(tableNumber);
      return tableNumber === '8' ? { tableNumber: '8' } : null;
    },
  };

  return {
    lookups,
    service: new GuestTableNumberValidationService(tables),
  };
}

function controllerHarness(options = {}) {
  const observed = {
    sequence: [],
    createCalls: 0,
    lockCalls: 0,
    tableChangeCalls: 0,
    createDto: null,
    tableChangeDto: null,
  };

  const service = {
    async create(dto) {
      observed.createCalls += 1;
      observed.createDto = dto;
      return { message: 'created' };
    },
  };
  const guestService = {
    async get(_id, token) {
      observed.sequence.push('ownership');
      if (token === 'bad-token') {
        throw new UnauthorizedException('Недійсний доступ до бронювання');
      }
      return { bookingId: 'booking-1' };
    },
  };
  const guestTelegramLink = {};
  const tableLock = {
    async withCreateLock(dto, action) {
      observed.lockCalls += 1;
      observed.createDto = dto;
      return action();
    },
  };
  const availabilityBlocks = {
    async assertBookable() {},
  };
  const adminAttention = {
    async requestTableChange(_id, _token, dto) {
      observed.tableChangeCalls += 1;
      observed.tableChangeDto = dto;
      return { message: 'requested' };
    },
  };
  const notifications = {};
  const guestTimeChange = {};
  const guestTableNumbers = {
    async resolveExisting(tableNumber) {
      observed.sequence.push('table');
      const normalized = String(tableNumber || '').trim();
      if (options.rejectTableNumber === normalized) {
        throw new BadRequestException(
          `Стіл №${normalized} не знайдено. Перевірте номер столу.`,
        );
      }
      return normalized || null;
    },
  };

  return {
    observed,
    controller: new BookingsController(
      service,
      guestService,
      guestTelegramLink,
      tableLock,
      availabilityBlocks,
      adminAttention,
      notifications,
      guestTimeChange,
      guestTableNumbers,
    ),
  };
}

test('guest table validator accepts an existing table number and normalizes spaces', async () => {
  const { lookups, service } = validationService();

  assert.equal(await service.resolveExisting(' 8 '), '8');
  assert.deepEqual(lookups, ['8']);
});

test('guest table validator rejects unknown table 999', async () => {
  const { lookups, service } = validationService();

  await assert.rejects(
    () => service.resolveExisting('999'),
    (error) =>
      error instanceof BadRequestException &&
      error.message === 'Стіл №999 не знайдено. Перевірте номер столу.',
  );
  assert.deepEqual(lookups, ['999']);
});

test('public booking with unknown table number is rejected before booking creation', async () => {
  const { controller, observed } = controllerHarness({ rejectTableNumber: '999' });

  await assert.rejects(
    () => controller.create({ tableId: 'visual-999', tableNumber: '999' }),
    BadRequestException,
  );

  assert.equal(observed.lockCalls, 0);
  assert.equal(observed.createCalls, 0);
});

test('public booking with existing table number keeps visual fallback compatible', async () => {
  const { controller, observed } = controllerHarness();

  await controller.create({ tableId: 'visual-8', tableNumber: ' 8 ' });

  assert.equal(observed.lockCalls, 1);
  assert.equal(observed.createCalls, 1);
  assert.equal(observed.createDto.tableId, 'visual-8');
  assert.equal(observed.createDto.tableNumber, '8');
});

test('guest table-change validates booking ownership before checking table number', async () => {
  const { controller, observed } = controllerHarness({ rejectTableNumber: '999' });

  await assert.rejects(
    () => controller.guestChangeTable('booking-1', 'good-token', { tableNumber: '999' }),
    BadRequestException,
  );

  assert.deepEqual(observed.sequence, ['ownership', 'table']);
  assert.equal(observed.tableChangeCalls, 0);
});

test('invalid booking token is rejected before table-number existence is disclosed', async () => {
  const { controller, observed } = controllerHarness({ rejectTableNumber: '999' });

  await assert.rejects(
    () => controller.guestChangeTable('booking-1', 'bad-token', { tableNumber: '999' }),
    UnauthorizedException,
  );

  assert.deepEqual(observed.sequence, ['ownership']);
  assert.equal(observed.tableChangeCalls, 0);
});

test('guest table-change with an existing number reaches the existing Admin request flow', async () => {
  const { controller, observed } = controllerHarness();

  await controller.guestChangeTable('booking-1', 'good-token', { tableNumber: ' 8 ' });

  assert.deepEqual(observed.sequence, ['ownership', 'table']);
  assert.equal(observed.tableChangeCalls, 1);
  assert.equal(observed.tableChangeDto.tableNumber, '8');
});
