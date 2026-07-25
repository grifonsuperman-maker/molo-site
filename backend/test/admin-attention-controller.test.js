const assert = require('node:assert/strict');
const test = require('node:test');

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
