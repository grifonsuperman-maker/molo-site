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
    deletePermanently: (id) => {
      calls.push(['deletePermanently', id]);
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

test('Director cannot archive own account', async () => {
  const { controller, calls } = createController();

  await assert.rejects(
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

test('Director cannot permanently delete own account', () => {
  const { controller, calls } = createController();

  assert.throws(
    () => controller.deletePermanently('director-1', { user: directorUser }),
    /не може видалити власний обліковий запис/,
  );
  assert.deepEqual(calls, []);
});

test('Director can permanently delete another employee', () => {
  const { controller, calls } = createController();

  const result = controller.deletePermanently('waiter-1', { user: directorUser });

  assert.deepEqual(result, { id: 'waiter-1' });
  assert.deepEqual(calls, [['deletePermanently', 'waiter-1']]);
});
