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

function createController({ targetRole = 'waiter', permissionError = null } = {}) {
  const calls = [];
  const service = {
    findOne: async (id) => ({ id, role: targetRole }),
    create: async (dto) => {
      calls.push(['create', dto]);
      return { id: 'new-staff', ...dto };
    },
    update: async (id, dto) => {
      calls.push(['update', id, dto]);
      return { id, role: targetRole, ...dto };
    },
    setActive: async (id, active) => {
      calls.push(['setActive', id, active]);
      return { id, role: targetRole, active };
    },
    archive: async (id, dto) => {
      calls.push(['archive', id, dto]);
      return { id, role: targetRole, isArchived: true };
    },
    restore: async (id, dto) => {
      calls.push(['restore', id, dto]);
      return { id, role: targetRole, isArchived: false };
    },
  };
  const permissions = {
    assert: async () => {
      if (permissionError) throw permissionError;
    },
  };

  return { controller: new StaffController(service, permissions), calls };
}

test('Admin with permission can create waiter', async () => {
  const { controller, calls } = createController();
  const dto = { fullName: 'Олексій', role: 'waiter', pin: '1234' };

  const result = await controller.create(dto, { user: adminUser });

  assert.equal(result.role, 'waiter');
  assert.deepEqual(calls, [['create', dto]]);
});

test('Admin with permission can create hookah worker', async () => {
  const { controller, calls } = createController();
  const dto = { fullName: 'Іван', role: 'hookah', pin: '4567' };

  const result = await controller.create(dto, { user: adminUser });

  assert.equal(result.role, 'hookah');
  assert.deepEqual(calls, [['create', dto]]);
});

test('Admin cannot create another administrator', async () => {
  const { controller, calls } = createController();

  await assert.rejects(
    () => controller.create(
      { fullName: 'Другий адмін', role: 'admin', pin: '1234' },
      { user: adminUser },
    ),
    /лише офіціантами та кальянниками/,
  );
  assert.deepEqual(calls, []);
});

test('Admin can change PIN of ordinary employee', async () => {
  const { controller, calls } = createController({ targetRole: 'hookah' });

  await controller.update('hookah-1', { pin: '9876' }, { user: adminUser });

  assert.deepEqual(calls, [['update', 'hookah-1', { pin: '9876' }]]);
});

test('Admin cannot edit administrator account', async () => {
  const { controller, calls } = createController({ targetRole: 'admin' });

  await assert.rejects(
    () => controller.update('admin-2', { fullName: 'Нове ім’я' }, { user: adminUser }),
    /лише офіціантами та кальянниками/,
  );
  assert.deepEqual(calls, []);
});

test('Admin cannot manage staff without Director permission', async () => {
  const permissionError = new Error('Директор не надав це право Адміністратору');
  const { controller, calls } = createController({ permissionError });

  await assert.rejects(
    () => controller.create(
      { fullName: 'Офіціант', role: 'waiter', pin: '1234' },
      { user: adminUser },
    ),
    (error) => error === permissionError,
  );
  assert.deepEqual(calls, []);
});
