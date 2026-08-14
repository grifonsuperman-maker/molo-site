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
    query: async (sql) => {
      const normalized = sql.replace(/\s+/g, ' ').trim();

      if (normalized.startsWith('SELECT director_failed_login_attempts')) {
        return [
          {
            director_failed_login_attempts:
              director.directorFailedLoginAttempts,
            director_locked_until: director.directorLockedUntil,
          },
        ];
      }

      if (
        normalized.startsWith(
          'UPDATE staff SET director_failed_login_attempts = 0',
        )
      ) {
        const lockedUntil = director.directorLockedUntil
          ? new Date(director.directorLockedUntil)
          : null;

        if (!lockedUntil || lockedUntil.getTime() > Date.now()) {
          return [];
        }

        director.directorFailedLoginAttempts = 0;
        director.directorLockedUntil = null;
        return [
          {
            director_failed_login_attempts: 0,
            director_locked_until: null,
          },
        ];
      }

      if (
        normalized.startsWith(
          'UPDATE staff SET director_failed_login_attempts = director_failed_login_attempts + 1',
        )
      ) {
        director.directorFailedLoginAttempts =
          Number(director.directorFailedLoginAttempts || 0) + 1;

        if (
          director.directorFailedLoginAttempts >= 5 &&
          (!director.directorLockedUntil ||
            new Date(director.directorLockedUntil).getTime() <= Date.now())
        ) {
          director.directorLockedUntil = new Date(Date.now() + 15 * 60_000);
        }

        return [
          {
            director_failed_login_attempts:
              director.directorFailedLoginAttempts,
            director_locked_until: director.directorLockedUntil,
          },
        ];
      }

      throw new Error(`Unexpected query in test: ${normalized}`);
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

test('wrong temporary PIN is counted and does not open Director panel', async () => {
  const { service, director } = createService();

  await assert.rejects(
    () =>
      service.loginDirector({
        staffId: director.id,
        temporaryPin: '0000',
      }),
    /Залишилось спроб: 4/,
  );

  assert.equal(director.directorFailedLoginAttempts, 1);
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

test('legacy staff PIN route cannot be used by Director', async () => {
  const director = createDirector({ pinHash: 'legacy-pin-hash' });
  const { service } = createService(director);

  await assert.rejects(
    () =>
      service.loginWithPin({
        staffId: director.id,
        pin: '1111',
      }),
    /Для Директора використовуйте окремий вхід/,
  );
});

test('changing configured Director credentials requires current password', async () => {
  const { service, director } = createService();
  const user = {
    sub: director.id,
    staffId: director.id,
    telegramId: `staff:${director.id}`,
    role: 'owner',
    name: director.fullName,
  };

  await service.updateDirectorAccess(user, {
    fullName: director.fullName,
    loginName: 'director',
    newPassword: 'secure-123',
    confirmPassword: 'secure-123',
  });

  await assert.rejects(
    () =>
      service.updateDirectorAccess(user, {
        fullName: 'Новий Директор',
        loginName: 'new-director',
        currentPassword: 'wrong-password',
        newPassword: 'secure-456',
        confirmPassword: 'secure-456',
      }),
    /Поточний пароль невірний/,
  );

  const updated = await service.updateDirectorAccess(user, {
    fullName: 'Новий Директор',
    loginName: 'new-director',
    currentPassword: 'secure-123',
    newPassword: 'secure-456',
    confirmPassword: 'secure-456',
  });

  assert.equal(updated.fullName, 'Новий Директор');
  assert.equal(updated.loginName, 'new-director');
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

test('parallel wrong Director passwords are all counted atomically', async () => {
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

  const results = await Promise.allSettled(
    Array.from({ length: 5 }, () =>
      service.loginDirector({
        loginName: 'director',
        password: 'wrong-password',
      }),
    ),
  );

  assert.ok(results.every((result) => result.status === 'rejected'));
  assert.equal(director.directorFailedLoginAttempts, 5);
  assert.ok(director.directorLockedUntil instanceof Date);
});
