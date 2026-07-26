require('reflect-metadata');

const assert = require('node:assert/strict');
const test = require('node:test');
const { BadRequestException } = require('@nestjs/common');

const { StaffController } = require('../dist/staff/staff.controller.js');

const adminUser = {
  sub: 'admin-1',
  staffId: 'admin-1',
  telegramId: 'staff:admin-1',
  role: 'admin',
  name: 'Адміністратор',
};

function createController(serviceOverrides = {}, permissionError = null) {
  const service = {
    startShift: async () => ({ id: 'waiter-1', isOnShift: true }),
    endShift: async () => ({ id: 'waiter-1', isOnShift: false }),
    findOne: async () => ({ id: 'waiter-1', isOnShift: false }),
    ...serviceOverrides,
  };
  const permissions = {
    assert: async () => {
      if (permissionError) throw permissionError;
    },
  };

  return new StaffController(service, permissions);
}

function exceptionMessage(error) {
  const response = error.getResponse();
  return typeof response === 'string' ? response : response.message;
}

test('Admin gets persisted open shift when audit write failed after save', async () => {
  const controller = createController({
    startShift: async () => {
      throw new Error('staff_shift_events insert failed');
    },
    findOne: async () => ({ id: 'waiter-1', isOnShift: true }),
  });

  const result = await controller.startShift(
    'waiter-1',
    {},
    { user: adminUser },
  );

  assert.equal(result.isOnShift, true);
});

test('Admin gets persisted closed shift when audit write failed after save', async () => {
  const controller = createController({
    endShift: async () => {
      throw new Error('staff_shift_events insert failed');
    },
    findOne: async () => ({ id: 'waiter-1', isOnShift: false }),
  });

  const result = await controller.endShift(
    'waiter-1',
    {},
    { user: adminUser },
  );

  assert.equal(result.isOnShift, false);
});

test('Known shift validation error is preserved when requested state was not saved', async () => {
  const originalError = new BadRequestException('Працівника не можна додати на зміну');
  const controller = createController({
    startShift: async () => {
      throw originalError;
    },
    findOne: async () => ({ id: 'waiter-1', isOnShift: false }),
  });

  await assert.rejects(
    () => controller.startShift('waiter-1', {}, { user: adminUser }),
    (error) => error === originalError,
  );
});

test('Unknown shift failure returns diagnostic code and logs PostgreSQL details', async () => {
  const databaseError = Object.assign(new Error('column does not exist'), {
    code: '42703',
    constraint: 'staff_shift_events_staff_id_fkey',
    table: 'staff_shift_events',
    column: 'staff_id',
    query: 'INSERT INTO staff_shift_events ...',
    parameters: ['waiter-1'],
  });
  const controller = createController({
    startShift: async () => {
      throw databaseError;
    },
    findOne: async () => ({ id: 'waiter-1', isOnShift: false }),
  });
  const logs = [];
  controller.logger.error = (...args) => logs.push(args);

  let caught;
  try {
    await controller.startShift('waiter-1', {}, { user: adminUser });
  } catch (error) {
    caught = error;
  }

  assert.ok(caught);
  assert.equal(caught.getStatus(), 500);
  const message = exceptionMessage(caught);
  const diagnosticId = message.match(/SHIFT-[A-F0-9]{8}/)?.[0];
  assert.ok(diagnosticId);

  assert.equal(logs.length, 1);
  const payload = JSON.parse(logs[0][0]);
  assert.equal(payload.event, 'staff_shift_action_failed');
  assert.equal(payload.diagnosticId, diagnosticId);
  assert.equal(payload.stage, 'start_shift');
  assert.equal(payload.staffId, 'waiter-1');
  assert.equal(payload.expectedOnShift, true);
  assert.equal(payload.actualOnShift, false);
  assert.equal(payload.postgresCode, '42703');
  assert.equal(payload.postgresConstraint, 'staff_shift_events_staff_id_fkey');
  assert.equal(payload.postgresTable, 'staff_shift_events');
  assert.equal(payload.postgresColumn, 'staff_id');
  assert.equal(payload.query, 'INSERT INTO staff_shift_events ...');
  assert.deepEqual(payload.parameters, ['waiter-1']);
});

test('Director permission denial is preserved before shift action', async () => {
  const permissionError = new Error('Директор не надав це право Адміністратору');
  let called = false;
  const controller = createController(
    {
      startShift: async () => {
        called = true;
        return { id: 'waiter-1', isOnShift: true };
      },
    },
    permissionError,
  );

  await assert.rejects(
    () => controller.startShift('waiter-1', {}, { user: adminUser }),
    (error) => error === permissionError,
  );
  assert.equal(called, false);
});
