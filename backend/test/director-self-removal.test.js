require('reflect-metadata');

const assert = require('node:assert/strict');
const test = require('node:test');

const { StaffController } = require('../dist/staff/staff.controller.js');

function createController() {
  const calls = [];
  const service = {
    remove: (id) => {
      calls.push(['remove', id]);
      return { id };
    },
    archive: (id, dto) => {
      calls.push(['archive', id, dto]);
      return { id };
    },
  };
  const permissions = { assert: async () => undefined };
  return { controller: new StaffController(service, permissions), calls };
}

const directorUser = {
  sub: 'director-1',
  staffId: 'director-1',
  telegramId: 'staff:director-1',
  role: 'owner',
  name: 'Директор MOLO',
};

test('Director cannot delete own account', () => {
  const { controller, calls } = createController();

  assert.throws(
    () => controller.remove('director-1', { user: directorUser }),
    /не може видалити власний обліковий запис/,
  );
  assert.deepEqual(calls, []);
});

test('Director cannot archive own account', () => {
  const { controller, calls } = createController();

  assert.throws(
    () => controller.archive('director-1', {}, { user: directorUser }),
    /не може видалити власний обліковий запис/,
  );
  assert.deepEqual(calls, []);
});

test('Director can remove another employee', () => {
  const { controller, calls } = createController();

  const result = controller.remove('waiter-1', { user: directorUser });

  assert.deepEqual(result, { id: 'waiter-1' });
  assert.deepEqual(calls, [['remove', 'waiter-1']]);
});
