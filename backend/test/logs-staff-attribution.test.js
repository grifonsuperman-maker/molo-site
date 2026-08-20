const assert = require('node:assert/strict');
const test = require('node:test');

const { LogsService } = require('../dist/logs/logs.service.js');

test('activity log links the employee from staffId details when no Staff object is passed', async () => {
  const saved = [];
  const logsRepo = {
    create(value) {
      return value;
    },
    async save(value) {
      saved.push(value);
      return value;
    },
  };

  const service = new LogsService(logsRepo);
  const staffId = '33333333-3333-4333-8333-333333333333';

  await service.create('Стіл звільнено', null, {
    bookingId: 'booking-1',
    staffId,
    staffName: 'Олександр',
    role: 'waiter',
  });

  assert.equal(saved.length, 1);
  assert.equal(saved[0].staff.id, staffId);
  assert.equal(saved[0].details.staffName, 'Олександр');
  assert.equal(saved[0].details.role, 'waiter');
});

test('explicit Staff relation still has priority over details', async () => {
  const saved = [];
  const logsRepo = {
    create(value) {
      return value;
    },
    async save(value) {
      saved.push(value);
      return value;
    },
  };

  const service = new LogsService(logsRepo);
  const explicitStaff = { id: '44444444-4444-4444-8444-444444444444' };

  await service.create('Тест', explicitStaff, {
    staffId: '55555555-5555-4555-8555-555555555555',
  });

  assert.equal(saved[0].staff, explicitStaff);
});
