const assert = require('node:assert/strict');
const test = require('node:test');

const { StaffService } = require('../dist/staff/staff.service.js');

function createService(staff) {
  const removed = [];
  const staffRepo = {
    findOne: async () => staff,
    remove: async (value) => {
      removed.push(value);
      return value;
    },
  };

  return {
    service: new StaffService(staffRepo, {}, {}),
    removed,
  };
}

test('permanently deletes an archived employee', async () => {
  const staff = { id: 'waiter-1', role: 'waiter', isArchived: true };
  const { service, removed } = createService(staff);

  const result = await service.deletePermanently(staff.id);

  assert.deepEqual(result, { id: staff.id });
  assert.deepEqual(removed, [staff]);
});

test('requires an employee to be archived before permanent deletion', async () => {
  const staff = { id: 'waiter-1', role: 'waiter', isArchived: false };
  const { service, removed } = createService(staff);

  await assert.rejects(
    () => service.deletePermanently(staff.id),
    /Спочатку перемістіть працівника до архіву/,
  );
  assert.deepEqual(removed, []);
});

test('never permanently deletes a Director account', async () => {
  const staff = { id: 'director-2', role: 'owner', isArchived: true };
  const { service, removed } = createService(staff);

  await assert.rejects(
    () => service.deletePermanently(staff.id),
    /Директора не можна видалити назавжди/,
  );
  assert.deepEqual(removed, []);
});
