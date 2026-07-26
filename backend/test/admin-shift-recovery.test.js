require('reflect-metadata');

const assert = require('node:assert/strict');
const test = require('node:test');

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

test('Shift error is not hidden when requested state was not saved', async () => {
  const originalError = new Error('staff save failed');
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
