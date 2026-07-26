const assert = require('node:assert/strict');
const test = require('node:test');

const { StaffService } = require('../dist/staff/staff.service.js');

function createDirector(overrides = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    telegramId: null,
    fullName: 'Директор MOLO',
    phone: null,
    role: 'owner',
    pinHash: null,
    directorLoginName: null,
    directorPasswordHash: null,
    directorCredentialsConfiguredAt: null,
    directorFailedLoginAttempts: 0,
    directorLockedUntil: null,
    note: null,
    active: true,
    isArchived: false,
    isOnShift: false,
    shiftStartedAt: null,
    shiftStartedBy: null,
    shiftEndedAt: null,
    shiftEndedBy: null,
    lastAutoShiftEndDate: null,
    archivedAt: null,
    archivedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function createService(director = createDirector()) {
  const repository = {
    find: async ({ where } = {}) => {
      if (where?.role === 'owner') return [director];
      return [director];
    },
    findOne: async ({ where }) => {
      if (where.id && where.id !== director.id) return null;
      if (
        where.directorLoginName &&
        where.directorLoginName !== director.directorLoginName
      ) {
        return null;
      }
      if (where.role && where.role !== director.role) return null;
      if (where.active !== undefined && where.active !== director.active) return null;
      if (
        where.isArchived !== undefined &&
        where.isArchived !== director.isArchived
      ) {
        return null;
      }
      return director;
    },
    save: async (value) => value,
    create: (value) => value,
  };

  const shiftRepository = {
    find: async () => [],
    save: async (value) => value,
    create: (value) => value,
  };

  const jwtService = {
    signAsync: async () => 'director-token',
  };

  return {
    director,
    service: new StaffService(repository, shiftRepository, jwtService),
  };
}

test('temporary PIN 1111 opens Director panel before credentials are configured', async () => {
  const { service, director } = createService();

  const result = await service.loginDirector({
    staffId: director.id,
    temporaryPin: '1111',
  });

  assert.equal(result.accessToken, 'director-token');
  assert.equal(result.user.role, 'owner');
  assert.equal(result.mustConfigureDirectorAccess, true);
});

test('saving Director name and password disables temporary PIN', async () => {
  const { service, director } = createService();

  const settings = await service.updateDirectorAccess(
    {
      sub: director.id,
      staffId: director.id,
      telegramId: `staff:${director.id}`,
      role: 'owner',
      name: director.fullName,
    },
    {
      fullName: 'Олександр',
      loginName: 'director',
      newPassword: 'secure-123',
      confirmPassword: 'secure-123',
    },
  );

  assert.equal(settings.configured, true);
  assert.equal(settings.loginName, 'director');
  assert.ok(director.directorPasswordHash);

  await assert.rejects(
    () =>
      service.loginDirector({
        staffId: director.id,
        temporaryPin: '1111',
      }),
    /Тимчасовий доступ недоступний/,
  );

  const login = await service.loginDirector({
    loginName: 'director',
    password: 'secure-123',
  });
  assert.equal(login.mustConfigureDirectorAccess, false);
});

test('Director login is locked for 15 minutes after five wrong passwords', async () => {
  const { service, director } = createService();

  await service.updateDirectorAccess(
    {
      sub: director.id,
      staffId: director.id,
      telegramId: `staff:${director.id}`,
      role: 'owner',
      name: director.fullName,
    },
    {
      fullName: director.fullName,
      loginName: 'director',
      newPassword: 'secure-123',
      confirmPassword: 'secure-123',
    },
  );

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    await assert.rejects(
      () =>
        service.loginDirector({
          loginName: 'director',
          password: 'wrong-password',
        }),
      /Залишилось спроб/,
    );
  }

  await assert.rejects(
    () =>
      service.loginDirector({
        loginName: 'director',
        password: 'wrong-password',
      }),
    /заблоковано на 15 хв/,
  );

  assert.ok(director.directorLockedUntil instanceof Date);
});
