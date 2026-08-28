require('reflect-metadata');

const assert = require('node:assert/strict');
const test = require('node:test');

const { ROLES_KEY } = require('../dist/common/decorators/roles.decorator.js');
const {
  AdminAttentionController,
} = require('../dist/bookings/admin-attention.controller.js');

test('admin reschedule list reuses the existing pending-reschedule query', async () => {
  const expected = [{ id: 'reschedule-1', status: 'pending' }];
  const bookings = {
    async getPendingReschedules() {
      return expected;
    },
  };
  const controller = new AdminAttentionController({}, bookings, {});

  assert.deepEqual(await controller.reschedules(), expected);
});

test('admin reschedule approval delegates to the existing atomic approval service', async () => {
  const calls = [];
  const approval = {
    async approve(requestId) {
      calls.push(requestId);
      return { message: 'Перенесення підтверджено' };
    },
  };
  const controller = new AdminAttentionController({}, {}, approval);

  const result = await controller.approveReschedule('reschedule-1');

  assert.deepEqual(calls, ['reschedule-1']);
  assert.deepEqual(result, { message: 'Перенесення підтверджено' });
});

test('admin reschedule rejection delegates to the existing rejection service', async () => {
  const calls = [];
  const bookings = {
    async rejectReschedule(requestId, payload) {
      calls.push({ requestId, payload });
      return { message: 'Перенесення відхилено' };
    },
  };
  const controller = new AdminAttentionController({}, bookings, {});
  const payload = { adminComment: 'Час уже зайнятий' };

  const result = await controller.rejectReschedule('reschedule-1', payload);

  assert.deepEqual(calls, [{ requestId: 'reschedule-1', payload }]);
  assert.deepEqual(result, { message: 'Перенесення відхилено' });
});

test('web reschedule endpoints are restricted to Admin and do not inherit Director access', () => {
  for (const methodName of [
    'reschedules',
    'approveReschedule',
    'rejectReschedule',
  ]) {
    assert.deepEqual(
      Reflect.getMetadata(
        ROLES_KEY,
        AdminAttentionController.prototype[methodName],
      ),
      ['admin'],
      `${methodName} must stay admin-only`,
    );
  }
});
