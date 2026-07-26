const assert = require('node:assert/strict');
const test = require('node:test');

const {
  StaffBootstrapService,
} = require('../dist/staff/staff-bootstrap.service.js');

function withoutAdminBootstrap(action) {
  const previousName = process.env.MOLO_BOOTSTRAP_ADMIN_NAME;
  const previousPin = process.env.MOLO_BOOTSTRAP_ADMIN_PIN;
  delete process.env.MOLO_BOOTSTRAP_ADMIN_NAME;
  delete process.env.MOLO_BOOTSTRAP_ADMIN_PIN;

  return Promise.resolve()
    .then(action)
    .finally(() => {
      if (previousName === undefined) delete process.env.MOLO_BOOTSTRAP_ADMIN_NAME;
      else process.env.MOLO_BOOTSTRAP_ADMIN_NAME = previousName;
      if (previousPin === undefined) delete process.env.MOLO_BOOTSTRAP_ADMIN_PIN;
      else process.env.MOLO_BOOTSTRAP_ADMIN_PIN = previousPin;
    });
}

test('creates one active bootstrap Director when the database has none', async () => {
  const saved = [];
  const repository = {
    findOne: async ({ where }) => {
      if (where.role === 'owner' && where.active === true) return null;
      return null;
    },
    create: (value) => ({ id: 'bootstrap-director', ...value }),
    save: async (value) => {
      saved.push(value);
      return value;
    },
  };

  await withoutAdminBootstrap(() =>
    new StaffBootstrapService(repository).onModuleInit(),
  );

  assert.equal(saved.length, 1);
  assert.equal(saved[0].role, 'owner');
  assert.equal(saved[0].fullName, 'Директор MOLO');
  assert.equal(saved[0].active, true);
  assert.equal(saved[0].isArchived, false);
  assert.equal(saved[0].directorLoginName, null);
  assert.equal(saved[0].directorPasswordHash, null);
});

test('does not create a duplicate when an active Director already exists', async () => {
  const activeDirector = {
    id: 'existing-director',
    role: 'owner',
    active: true,
    isArchived: false,
  };
  const saved = [];
  const repository = {
    findOne: async ({ where }) => {
      if (where.role === 'owner' && where.active === true) return activeDirector;
      return null;
    },
    create: (value) => value,
    save: async (value) => {
      saved.push(value);
      return value;
    },
  };

  await withoutAdminBootstrap(() =>
    new StaffBootstrapService(repository).onModuleInit(),
  );

  assert.equal(saved.length, 0);
});
