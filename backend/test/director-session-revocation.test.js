const assert = require('node:assert/strict');
const test = require('node:test');
const { hashSync } = require('bcryptjs');

const { AuthService } = require('../dist/auth/auth.service.js');
const { StaffService } = require('../dist/staff/staff.service.js');
const { StaffController } = require('../dist/staff/staff.controller.js');

const DIRECTOR_ID = '11111111-1111-4111-8111-111111111111';

function fixture(overrides = {}) {
  const director = {
    id: DIRECTOR_ID,
    telegramId: '777',
    role: 'owner',
    fullName: 'Директор MOLO',
    directorLoginName: 'director',
    directorPasswordHash: hashSync('old-password', 4),
    directorCredentialsConfiguredAt: new Date('2026-09-01T12:00:00Z'),
    directorFailedLoginAttempts: 0,
    directorLockedUntil: null,
    active: true,
    isArchived: false,
    isOnShift: false,
    ...overrides,
  };
  const repository = {
    findOne: async ({ where }) => {
      if (where.id !== undefined && where.id !== director.id) return null;
      if (where.telegramId !== undefined && where.telegramId !== director.telegramId) return null;
      if (where.directorLoginName !== undefined && where.directorLoginName !== director.directorLoginName) return null;
      if (where.role !== undefined && where.role !== director.role) return null;
      if (where.active !== undefined && where.active !== director.active) return null;
      if (where.isArchived !== undefined && where.isArchived !== director.isArchived) return null;
      return director;
    },
    save: async (value) => value,
  };
  const jwt = {
    signAsync: async (payload) => JSON.stringify(payload),
    verifyAsync: async (token) => JSON.parse(token),
  };
  const auth = new AuthService(repository, jwt);
  const staff = new StaffService(repository, {}, jwt);
  const controller = new StaffController(staff, {}, {}, {}, auth);
  return { director, auth, staff, controller };
}

test('Director password change revokes old password and Telegram JWTs but allows new login', async () => {
  const { director, auth, staff, controller } = fixture();
  const oldLogin = await controller.loginDirector({ loginName: 'director', password: 'old-password' });
  assert.equal((await auth.verifyToken(oldLogin.accessToken)).role, 'owner');

  // authenticateTelegram uses the same signed credential fingerprint for Director.
  auth.resolveTelegramUser = () => ({ telegramId: '777', name: 'Director' });
  const oldTelegram = await auth.authenticateTelegram({});
  assert.equal((await auth.verifyToken(oldTelegram.accessToken)).role, 'owner');

  await staff.updateDirectorAccess(oldLogin.user, {
    fullName: director.fullName,
    loginName: 'new-director',
    currentPassword: 'old-password',
    newPassword: 'new-password',
    confirmPassword: 'new-password',
  });

  await assert.rejects(() => auth.verifyToken(oldLogin.accessToken), /Недійсний токен/);
  await assert.rejects(() => auth.verifyToken(oldTelegram.accessToken), /Недійсний токен/);
  await assert.rejects(
    () => controller.loginDirector({ loginName: 'director', password: 'old-password' }),
    /Невірне ім’я або пароль/,
  );
  const nextLogin = await controller.loginDirector({ loginName: 'new-director', password: 'new-password' });
  assert.equal((await auth.verifyToken(nextLogin.accessToken)).role, 'owner');
});

test('changing only Director login still revokes old sessions', async () => {
  const { director, auth, staff, controller } = fixture();
  const original = await controller.loginDirector({ loginName: 'director', password: 'old-password' });
  await staff.updateDirectorAccess(original.user, {
    fullName: director.fullName,
    loginName: 'renamed-director',
    currentPassword: 'old-password',
    newPassword: 'old-password',
    confirmPassword: 'old-password',
  });
  await assert.rejects(() => auth.verifyToken(original.accessToken), /Недійсний токен/);
  const fresh = await controller.loginDirector({ loginName: 'renamed-director', password: 'old-password' });
  assert.equal((await auth.verifyToken(fresh.accessToken)).role, 'owner');
});

test('bootstrap Director token is revoked by first credential configuration; legacy Director token is rejected', async () => {
  const { director, auth, staff, controller } = fixture({
    directorLoginName: null,
    directorPasswordHash: null,
    directorCredentialsConfiguredAt: null,
  });
  const bootstrap = await controller.loginDirector({ staffId: director.id, temporaryPin: '1111' });
  assert.equal(bootstrap.mustConfigureDirectorAccess, true);
  assert.equal((await auth.verifyToken(bootstrap.accessToken)).role, 'owner');
  await staff.updateDirectorAccess(bootstrap.user, {
    fullName: director.fullName,
    loginName: 'director',
    newPassword: 'new-password',
    confirmPassword: 'new-password',
  });
  await assert.rejects(() => auth.verifyToken(bootstrap.accessToken), /Недійсний токен/);
  await assert.rejects(
    () => auth.verifyToken(JSON.stringify({ ...bootstrap.user, directorCredentialFingerprint: undefined })),
    /Недійсний токен/,
  );
});

test('ordinary staff JWTs are not subject to Director fingerprint checks', async () => {
  const { director, auth } = fixture({ role: 'admin' });
  const staffJwt = JSON.stringify({ sub: director.id, staffId: director.id, role: 'admin', telegramId: '777' });
  assert.equal((await auth.verifyToken(staffJwt)).role, 'admin');
});
