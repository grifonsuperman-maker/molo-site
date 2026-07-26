const assert = require('node:assert/strict');
const test = require('node:test');
const {
  BadRequestException,
  InternalServerErrorException,
} = require('@nestjs/common');

const {
  AdminAttentionController,
} = require('../dist/bookings/admin-attention.controller.js');

test('admin approval delegates directly to the service-owned transaction', async () => {
  const calls = [];
  const attention = {
    async approveTableChange(requestId, tableId) {
      calls.push({ requestId, tableId });
      return { message: 'ok' };
    },
  };

  const controller = new AdminAttentionController(attention);
  const result = await controller.approveTableChange('request-1', 'table-38');

  assert.deepEqual(calls, [{ requestId: 'request-1', tableId: 'table-38' }]);
  assert.deepEqual(result, { message: 'ok' });
});

test('known validation errors keep their original message', async () => {
  const expected = new BadRequestException('Оберіть інший стіл');
  const controller = new AdminAttentionController({
    async approveTableChange() {
      throw expected;
    },
  });

  await assert.rejects(
    controller.approveTableChange('request-1', 'table-38'),
    (error) => error === expected,
  );
});

test('unexpected approval errors receive a diagnostic code and structured log', async () => {
  const databaseError = Object.assign(new Error('insert or update violates foreign key'), {
    code: '23503',
    detail: 'Key is not present',
    constraint: 'booking_table_change_requests_approved_table_id_fkey',
    table: 'booking_table_change_requests',
    column: 'approved_table_id',
    query: 'UPDATE booking_table_change_requests SET approved_table_id = $1',
    parameters: ['table-38'],
  });
  const controller = new AdminAttentionController({
    async approveTableChange() {
      throw databaseError;
    },
  });
  const logs = [];
  controller.logger = {
    error(message, stack) {
      logs.push({ message, stack });
    },
  };

  await assert.rejects(
    controller.approveTableChange('request-1', 'table-38'),
    (error) => {
      assert.ok(error instanceof InternalServerErrorException);
      assert.match(error.message, /Код діагностики: TRANSFER-[A-F0-9]{8}/);
      return true;
    },
  );

  assert.equal(logs.length, 1);
  const payload = JSON.parse(logs[0].message);
  assert.equal(payload.event, 'admin_table_change_approval_failed');
  assert.equal(payload.stage, 'approve_transaction');
  assert.equal(payload.requestId, 'request-1');
  assert.equal(payload.tableId, 'table-38');
  assert.equal(payload.postgresCode, '23503');
  assert.equal(payload.postgresConstraint, 'booking_table_change_requests_approved_table_id_fkey');
  assert.equal(payload.postgresColumn, 'approved_table_id');
  assert.match(payload.diagnosticId, /^TRANSFER-[A-F0-9]{8}$/);
  assert.match(logs[0].stack, /insert or update violates foreign key/);
});
