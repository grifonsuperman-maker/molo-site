const assert = require('node:assert/strict');
const test = require('node:test');

const { StaffService } = require('../dist/staff/staff.service.js');

function createService(staff, { promoteAfterRead = false } = {}) {
  const removed = [];
  const staffRepo = {
    findOne: async () => {
      if (!promoteAfterRead) return staff;
      const snapshot = { ...staff };
      staff.role = 'owner';
      return snapshot;
    },
    delete: async (where) => {
      if (where.id !== staff.id || where.role !== staff.role || where.isArchived !== staff.isArchived) {
        return { affected: 0 };
      }
      removed.push(staff);
      return { affected: 1 };
    },
    remove: async () => {
      throw new Error('Deletion must check the current role in the database');
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

test('cannot delete an employee promoted to Director after the initial read', async () => {
  const staff = { id: 'waiter-1', role: 'waiter', isArchived: true };
  const { service, removed } = createService(staff, { promoteAfterRead: true });

  await assert.rejects(
    () => service.deletePermanently(staff.id),
    /Дані працівника змінилися/,
  );
  assert.equal(staff.role, 'owner');
  assert.deepEqual(removed, []);
});
