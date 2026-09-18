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
  let transactionTail = Promise.resolve();
  let afterDirectorUpdate;
  const signedPayloads = [];
  let notifyTransactionStarted;
  const transactionStarted = new Promise((resolve) => {
    notifyTransactionStarted = resolve;
  });
  const updateDirector = async (where, values) => {
    if (where.id !== director.id || where.role !== director.role ||
        where.active !== director.active || where.isArchived !== director.isArchived) {
      return { affected: 0 };
    }
    const previous = where.directorCredentialsConfiguredAt;
    const versionMatches = previous?._type === 'isNull'
      ? director.directorCredentialsConfiguredAt === null
      : previous instanceof Date && director.directorCredentialsConfiguredAt instanceof Date &&
        previous.getTime() === director.directorCredentialsConfiguredAt.getTime();
    if (!versionMatches) return { affected: 0 };
    Object.assign(director, values);
    return { affected: 1 };
  };
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
    update: async (where, values) => {
      await transactionTail;
      const result = await updateDirector(where, values);
      if (result.affected === 1 && afterDirectorUpdate) {
        const callback = afterDirectorUpdate;
        afterDirectorUpdate = undefined;
        await callback();
      }
      return result;
    },
    create: (value) => value,
  };
  const transactionalRepository = {
    ...repository,
    update: updateDirector,
  };
  repository.manager = {
    transaction: async (callback) => {
      const previous = transactionTail;
      let release;
      transactionTail = new Promise((resolve) => { release = resolve; });
      await previous;
      notifyTransactionStarted();
      try {
        return await callback({ getRepository: () => transactionalRepository });
      } finally {
        release();
      }
    },
  };

  const shiftRepository = {
    find: async () => [],
    save: async (value) => value,
    create: (value) => value,
  };

  const jwtService = {
    signAsync: async (payload) => {
      signedPayloads.push(payload);
      return `director-token-${payload.directorSessionVersion ?? 'unversioned'}`;
    },
  };

  return {
    director,
    service: new StaffService(repository, shiftRepository, jwtService),
    setAfterDirectorUpdate: (callback) => { afterDirectorUpdate = callback; },
    signedPayloads,
    waitForDirectorLoginLock: () => transactionStarted,
  };
}

test('temporary PIN 1111 opens Director panel before credentials are configured', async () => {
  const { service, director } = createService();

  const result = await service.loginDirector({
    staffId: director.id,
    temporaryPin: '1111',
  });

  assert.match(result.accessToken, /^director-token-/);
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

test('credential update token never adopts a later concurrent CAS version', async () => {
  const {
    service,
    director,
    setAfterDirectorUpdate,
    signedPayloads,
  } = createService();
  const user = {
    sub: director.id,
    staffId: director.id,
    role: 'owner',
    name: director.fullName,
  };

  await service.updateDirectorAccess(user, {
    fullName: director.fullName,
    loginName: 'director',
    newPassword: 'initial-password',
    confirmPassword: 'initial-password',
  });

  let laterUpdate;
  setAfterDirectorUpdate(async () => {
    laterUpdate = await service.updateDirectorAccess(user, {
      fullName: 'Другий Директор',
      loginName: 'director-two',
      currentPassword: 'password-one',
      newPassword: 'password-two',
      confirmPassword: 'password-two',
    });
  });

  const firstUpdate = await service.updateDirectorAccess(user, {
    fullName: 'Перший Директор',
    loginName: 'director-one',
    currentPassword: 'initial-password',
    newPassword: 'password-one',
    confirmPassword: 'password-one',
  });

  const firstVersion = Number(firstUpdate.accessToken.split('-').at(-1));
  const laterVersion = Number(laterUpdate.accessToken.split('-').at(-1));
  assert.ok(laterVersion > firstVersion);
  assert.equal(firstUpdate.fullName, 'Перший Директор');
  assert.equal(firstUpdate.loginName, 'director-one');
  assert.equal(director.fullName, 'Другий Директор');
  assert.equal(director.directorCredentialsConfiguredAt.getTime(), laterVersion);
  assert.equal(signedPayloads.at(-1).directorSessionVersion, firstVersion);
  assert.notEqual(firstVersion, director.directorCredentialsConfiguredAt.getTime());
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

test('concurrent failed login cannot restore credentials changed after its row lock', async () => {
  const { service, director, waitForDirectorLoginLock } = createService();
  const user = {
    sub: director.id,
    staffId: director.id,
    role: 'owner',
    name: director.fullName,
  };
  await service.updateDirectorAccess(user, {
    fullName: director.fullName,
    loginName: 'director',
    newPassword: 'old-password',
    confirmPassword: 'old-password',
  });

  const failedLogin = service.loginDirector({
    loginName: 'director',
    password: 'wrong-password',
  });
  await waitForDirectorLoginLock();
  const changed = service.updateDirectorAccess(user, {
    fullName: director.fullName,
    loginName: 'director',
    currentPassword: 'old-password',
    newPassword: 'new-password',
    confirmPassword: 'new-password',
  });

  await assert.rejects(failedLogin, /Залишилось спроб: 4/);
  await changed;
  await assert.rejects(
    () => service.loginDirector({ loginName: 'director', password: 'old-password' }),
    /Невірні дані входу/,
  );
  assert.equal(
    (await service.loginDirector({ loginName: 'director', password: 'new-password' })).user.role,
    'owner',
  );
});

test('concurrent successful login reset cannot restore credentials after password change', async () => {
  const director = createDirector({ directorFailedLoginAttempts: 2 });
  const { service, waitForDirectorLoginLock } = createService(director);
  const user = {
    sub: director.id,
    staffId: director.id,
    role: 'owner',
    name: director.fullName,
  };
  await service.updateDirectorAccess(user, {
    fullName: director.fullName,
    loginName: 'director',
    newPassword: 'old-password',
    confirmPassword: 'old-password',
  });
  director.directorFailedLoginAttempts = 2;

  const successfulLogin = service.loginDirector({
    loginName: 'director',
    password: 'old-password',
  });
  await waitForDirectorLoginLock();
  const changed = service.updateDirectorAccess(user, {
    fullName: director.fullName,
    loginName: 'director',
    currentPassword: 'old-password',
    newPassword: 'new-password',
    confirmPassword: 'new-password',
  });

  await successfulLogin;
  await changed;
  assert.equal(director.directorFailedLoginAttempts, 0);
  await assert.rejects(
    () => service.loginDirector({ loginName: 'director', password: 'old-password' }),
    /Невірні дані входу/,
  );
  assert.equal(
    (await service.loginDirector({ loginName: 'director', password: 'new-password' })).user.role,
    'owner',
  );
});
