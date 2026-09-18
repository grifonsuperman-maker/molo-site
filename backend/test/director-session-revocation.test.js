const assert = require('node:assert/strict');
const test = require('node:test');
const { hash } = require('bcryptjs');

const { StaffService } = require('../dist/staff/staff.service.js');
const { AuthService } = require('../dist/auth/auth.service.js');
const {
  directorSessionVersion,
  nextDirectorCredentialsTimestamp,
} = require('../dist/auth/director-session-version.js');

function makeStaff(overrides = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    telegramId: '987654321',
    fullName: 'Директор MOLO',
    role: 'owner',
    active: true,
    isArchived: false,
    isOnShift: false,
    directorLoginName: 'director',
    directorPasswordHash: null,
    directorCredentialsConfiguredAt: null,
    directorFailedLoginAttempts: 0,
    directorLockedUntil: null,
    ...overrides,
  };
}

function setup(director = makeStaff()) {
  const waiter = makeStaff({
    id: '22222222-2222-4222-8222-222222222222',
    telegramId: '987654322',
    role: 'waiter',
    directorLoginName: null,
    isOnShift: true,
  });
  const members = [director, waiter];
  const repo = {
    findOne: async ({ where }) => members.find((staff) =>
      Object.entries(where).every(([field, value]) => staff[field] === value)
    ) || null,
    save: async (staff) => staff,
  };
  const shifts = { find: async () => [], save: async (event) => event, create: (event) => event };
  const jwt = {
    signAsync: async (payload) => JSON.stringify(payload),
    verifyAsync: async (token) => JSON.parse(token),
  };
  return {
    director,
    waiter,
    jwt,
    staff: new StaffService(repo, shifts, jwt),
    auth: new AuthService(repo, jwt),
  };
}

test('Director password change revokes old key, keeps current device and accepts new login', async () => {
  const { staff, auth, director } = setup();
  director.directorPasswordHash = await hash('old-password', 4);
  director.directorCredentialsConfiguredAt = new Date('2026-09-18T10:00:00.000Z');
  const oldLogin = await staff.loginDirector({ loginName: 'director', password: 'old-password' });
  const beforeChange = await auth.verifyToken(oldLogin.accessToken);
  assert.equal(beforeChange.role, 'owner');

  const settings = await staff.updateDirectorAccess(oldLogin.user, {
    fullName: 'Директор MOLO',
    loginName: 'director',
    currentPassword: 'old-password',
    newPassword: 'new-password',
    confirmPassword: 'new-password',
  });
  assert.equal(settings.configured, true);
  assert.ok(settings.accessToken);
  await assert.rejects(() => auth.verifyToken(oldLogin.accessToken), /Недійсний токен/);
  assert.equal((await auth.verifyToken(settings.accessToken)).role, 'owner');
  await assert.rejects(() => staff.loginDirector({ loginName: 'director', password: 'old-password' }), /Невірні дані входу/);
  const newLogin = await staff.loginDirector({ loginName: 'director', password: 'new-password' });
  assert.equal((await auth.verifyToken(newLogin.accessToken)).role, 'owner');
});

test('changing only Director login also revokes the previous session', async () => {
  const { staff, auth, director } = setup();
  director.directorPasswordHash = await hash('same-password', 4);
  director.directorCredentialsConfiguredAt = new Date('2026-09-18T10:00:00.000Z');
  const oldLogin = await staff.loginDirector({ loginName: 'director', password: 'same-password' });
  const settings = await staff.updateDirectorAccess(oldLogin.user, {
    fullName: 'Директор MOLO',
    loginName: 'new-director',
    currentPassword: 'same-password',
    newPassword: 'same-password',
    confirmPassword: 'same-password',
  });
  await assert.rejects(() => auth.verifyToken(oldLogin.accessToken), /Недійсний токен/);
  assert.equal((await auth.verifyToken(settings.accessToken)).role, 'owner');
  await assert.rejects(() => staff.loginDirector({ loginName: 'director', password: 'same-password' }), /Невірне ім’я або пароль/);
  const login = await staff.loginDirector({ loginName: 'new-director', password: 'same-password' });
  assert.equal((await auth.verifyToken(login.accessToken)).role, 'owner');
});

test('previous bootstrap and legacy Director JWTs are rejected after credentials are set', async () => {
  const { staff, auth, director } = setup(makeStaff({ directorLoginName: null }));
  const bootstrap = await staff.loginDirector({ staffId: director.id, temporaryPin: '1111' });
  const settings = await staff.updateDirectorAccess(bootstrap.user, {
    fullName: director.fullName,
    loginName: 'director',
    newPassword: 'safe-password',
    confirmPassword: 'safe-password',
  });
  await assert.rejects(() => auth.verifyToken(bootstrap.accessToken), /Недійсний токен/);
  const legacy = JSON.stringify({ ...settings, sub: director.id, staffId: director.id, role: 'owner' });
  await assert.rejects(() => auth.verifyToken(legacy), /Недійсний токен/);
  assert.equal((await auth.verifyToken(settings.accessToken)).role, 'owner');
});

test('Telegram-issued Director JWT uses the same revocation check, waiter JWT remains valid', async () => {
  const { auth, staff, director, waiter } = setup();
  director.directorPasswordHash = await hash('old-password', 4);
  director.directorCredentialsConfiguredAt = new Date('2026-09-18T10:00:00.000Z');
  const previous = { NODE_ENV: process.env.NODE_ENV, ALLOW_DEV_AUTH: process.env.ALLOW_DEV_AUTH, RENDER_EXTERNAL_URL: process.env.RENDER_EXTERNAL_URL };
  process.env.NODE_ENV = 'development';
  process.env.ALLOW_DEV_AUTH = 'true';
  delete process.env.RENDER_EXTERNAL_URL;
  let telegramLogin;
  try {
    telegramLogin = await auth.authenticateTelegram({ devTelegramId: director.telegramId });
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  assert.equal((await auth.verifyToken(telegramLogin.accessToken)).role, 'owner');
  const waiterToken = JSON.stringify({ sub: waiter.id, staffId: waiter.id, role: 'waiter' });
  const directorLogin = await staff.loginDirector({ loginName: 'director', password: 'old-password' });
  await staff.updateDirectorAccess(directorLogin.user, {
    fullName: director.fullName,
    loginName: 'director',
    currentPassword: 'old-password',
    newPassword: 'new-password',
    confirmPassword: 'new-password',
  });
  await assert.rejects(() => auth.verifyToken(telegramLogin.accessToken), /Недійсний токен/);
  assert.equal((await auth.verifyToken(waiterToken)).role, 'waiter');
});

test('Director session timestamp advances even for two changes in one millisecond', () => {
  const previous = new Date('2026-09-18T10:00:00.999Z');
  const next = nextDirectorCredentialsTimestamp(previous, previous.getTime());
  assert.equal(directorSessionVersion({ directorCredentialsConfiguredAt: next }), previous.getTime() + 1);
  assert.equal(directorSessionVersion({ directorCredentialsConfiguredAt: null }), 0);
});
