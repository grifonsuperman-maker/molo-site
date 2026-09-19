'use strict';

// Runs only in a disposable PostgreSQL service. No Render/Neon credentials,
// production database, Telegram API, application endpoints or migrations.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { createRequire } = require('node:module');
const { before, after, test } = require('node:test');

assert.equal(process.env.MOLO_PG_CONCURRENCY_TEST, 'true', 'Test opt-in required');
assert.equal(process.env.NODE_ENV, 'test');
assert.equal(process.env.DB_NAME, 'molo_fresh_schema_reference');
assert.ok(['localhost', '127.0.0.1', '::1'].includes(process.env.DB_HOST));
assert.ok(!process.env.DB_URL, 'External DB_URL forbidden');
assert.ok(!process.env.RENDER_EXTERNAL_URL, 'Production deployment forbidden');

const backendDir = process.env.MOLO_CANDIDATE_DIR;
assert.ok(path.isAbsolute(backendDir || ''), 'Absolute candidate backend path required');
const candidateRequire = createRequire(path.join(backendDir, 'package.json'));
candidateRequire('reflect-metadata');
const { DataSource } = candidateRequire('typeorm');
const { JwtService } = candidateRequire('@nestjs/jwt');
const { hash, compare } = candidateRequire('bcryptjs');
const { Staff } = candidateRequire('./dist/staff/entities/staff.entity.js');
const { StaffShiftEvent } = candidateRequire('./dist/staff/entities/staff-shift-event.entity.js');
const { StaffService } = candidateRequire('./dist/staff/staff.service.js');
const { AuthService } = candidateRequire('./dist/auth/auth.service.js');
const { TelegramStaffLinkService } = candidateRequire('./dist/staff/telegram-staff-link.service.js');

const secret = 'isolated-molo-postgres-race-secret-do-not-use-in-production';
const botToken = '123456:isolated-molo-test-bot-no-network';
process.env.JWT_SECRET = secret;
process.env.TELEGRAM_BOT_TOKEN = botToken;

const oldPassword = 'Old-password-for-PG-test';
let db;
let repo;
let directorService;
let authService;
let telegramLink;
let jwt;

function initData(userId) {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: 'isolated-pg-test',
    user: JSON.stringify({ id: userId, first_name: 'Тест' }),
  });
  const checkString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const key = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  params.set('hash', crypto.createHmac('sha256', key).update(checkString).digest('hex'));
  return params.toString();
}

async function seedDirector(label) {
  const loginName = `pg_${crypto.randomUUID().slice(0, 12)}`;
  const staff = await repo.save(repo.create({
    fullName: label,
    role: 'owner',
    active: true,
    isArchived: false,
    directorLoginName: loginName,
    directorPasswordHash: await hash(oldPassword, 4),
    directorCredentialsConfiguredAt: new Date(Date.now() - 60_000),
    directorFailedLoginAttempts: 0,
    directorLockedUntil: null,
  }));
  const login = await directorService.loginDirector({ loginName, password: oldPassword });
  assert.equal((await authService.verifyToken(login.accessToken)).staffId, staff.id);
  return { staff, loginName, login };
}

function rotation(fixture, password, currentPassword = oldPassword) {
  return directorService.updateDirectorAccess(fixture.login.user, {
    fullName: 'Директор PG test',
    loginName: fixture.loginName,
    currentPassword,
    newPassword: password,
    confirmPassword: password,
  });
}

async function rejectedToken(token) {
  await assert.rejects(() => authService.verifyToken(token), { status: 401 });
}

async function currentCredentials(fixture, password) {
  const current = await repo.findOneByOrFail({ id: fixture.staff.id });
  assert.equal(await compare(password, current.directorPasswordHash), true);
  assert.equal(await compare(oldPassword, current.directorPasswordHash), false);
  return current;
}

before(async () => {
  db = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    username: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    entities: [Staff, StaffShiftEvent],
    synchronize: false, // Schema created by guarded disposable-schema script.
    migrationsRun: false,
    logging: false,
    extra: { max: 12, connectionTimeoutMillis: 5000 },
  });
  await db.initialize();
  repo = db.getRepository(Staff);
  jwt = new JwtService({ secret });
  directorService = new StaffService(repo, db.getRepository(StaffShiftEvent), jwt);
  authService = new AuthService(repo, jwt);
  telegramLink = new TelegramStaffLinkService(repo, jwt, {
    getBotUsername: async () => 'molo_isolated_test_bot',
  });
});

after(async () => {
  if (db?.isInitialized) await db.destroy();
});

test('two concurrent password rotations commit only one version on real PostgreSQL', async () => {
  const fixture = await seedDirector('Concurrent director');
  const results = await Promise.allSettled([
    rotation(fixture, 'New-password-A-pg'),
    rotation(fixture, 'New-password-B-pg'),
  ]);
  const succeeded = results.filter((result) => result.status === 'fulfilled');
  const failed = results.filter((result) => result.status === 'rejected');
  assert.equal(succeeded.length, 1, 'Exactly one old-password CAS should succeed');
  assert.equal(failed.length, 1, 'The losing concurrent request must fail');
  assert.ok([401, 409].includes(failed[0].reason?.status));
  const winningPassword = results[0].status === 'fulfilled'
    ? 'New-password-A-pg' : 'New-password-B-pg';
  await currentCredentials(fixture, winningPassword);
  await rejectedToken(fixture.login.accessToken);
  assert.equal((await authService.verifyToken(succeeded[0].value.accessToken)).staffId, fixture.staff.id);
  await assert.rejects(
    () => directorService.loginDirector({ loginName: fixture.loginName, password: oldPassword }),
    { status: 401 },
  );
});

test('a login racing password rotation cannot leave a valid old-session token', async () => {
  const fixture = await seedDirector('Login race director');
  const results = await Promise.allSettled([
    directorService.loginDirector({ loginName: fixture.loginName, password: oldPassword }),
    rotation(fixture, 'New-password-after-login-race'),
  ]);
  assert.equal(results[1].status, 'fulfilled', 'Password rotation should succeed');
  await currentCredentials(fixture, 'New-password-after-login-race');
  await rejectedToken(fixture.login.accessToken);
  if (results[0].status === 'fulfilled') {
    await rejectedToken(results[0].value.accessToken);
  } else {
    assert.equal(results[0].reason?.status, 401);
  }
  assert.equal((await authService.verifyToken(results[1].value.accessToken)).staffId, fixture.staff.id);
});

test('concurrent wrong-password logins persist five attempts and lock correctly', async () => {
  const fixture = await seedDirector('Lockout race director');
  const attempts = await Promise.allSettled(Array.from({ length: 5 }, () =>
    directorService.loginDirector({ loginName: fixture.loginName, password: 'wrong-password' }),
  ));
  assert.ok(attempts.every((attempt) => attempt.status === 'rejected'));
  assert.ok(attempts.every((attempt) => attempt.reason?.status === 401));
  const locked = await repo.findOneByOrFail({ id: fixture.staff.id });
  assert.equal(locked.directorFailedLoginAttempts, 5);
  assert.ok(locked.directorLockedUntil?.getTime() > Date.now());
  await assert.rejects(
    () => directorService.loginDirector({ loginName: fixture.loginName, password: oldPassword }),
    { status: 401 },
  );
  await repo.update({ id: fixture.staff.id }, { directorLockedUntil: new Date(Date.now() - 1000) });
  const login = await directorService.loginDirector({ loginName: fixture.loginName, password: oldPassword });
  assert.equal((await authService.verifyToken(login.accessToken)).staffId, fixture.staff.id);
  const reset = await repo.findOneByOrFail({ id: fixture.staff.id });
  assert.equal(reset.directorFailedLoginAttempts, 0);
  assert.equal(reset.directorLockedUntil, null);
});

test('Telegram invitation and password rotation cannot grant a surviving old-password token', async () => {
  const fixture = await seedDirector('Telegram race director');
  const invite = await telegramLink.createInvite(fixture.staff.id);
  const token = new URL(invite.inviteUrl).searchParams.get('startapp').slice('staff_'.length);
  const confirmation = telegramLink.confirmInvite({
    token,
    initData: initData(900000101),
    password: oldPassword,
  });
  const rotate = rotation(fixture, 'New-password-after-Telegram-race');
  const results = await Promise.allSettled([confirmation, rotate]);
  assert.equal(results[1].status, 'fulfilled', 'Rotation should succeed');
  await currentCredentials(fixture, 'New-password-after-Telegram-race');
  await rejectedToken(fixture.login.accessToken);
  if (results[0].status === 'fulfilled') {
    await rejectedToken(results[0].value.accessToken);
  } else {
    assert.equal(results[0].reason?.status, 401);
    // The rejected race must not consume the invitation.
    const staff = await repo.findOneByOrFail({ id: fixture.staff.id });
    assert.equal(staff.telegramId, null);
    const retried = await telegramLink.confirmInvite({
      token,
      initData: initData(900000101),
      password: 'New-password-after-Telegram-race',
    });
    assert.equal((await authService.verifyToken(retried.accessToken)).staffId, fixture.staff.id);
  }
  assert.equal((await authService.verifyToken(results[1].value.accessToken)).staffId, fixture.staff.id);
});

test('expired Telegram invite cleanup racing rotation cannot restore old credentials', async () => {
  const fixture = await seedDirector('Expired invite director');
  const token = `expired_${crypto.randomUUID()}`;
  await repo.update({ id: fixture.staff.id }, {
    telegramInviteTokenHash: crypto.createHash('sha256').update(token).digest('hex'),
    telegramInviteExpiresAt: new Date(Date.now() - 30_000),
  });
  const results = await Promise.allSettled([
    telegramLink.getInviteInfo(token),
    rotation(fixture, 'New-password-after-expiry'),
  ]);
  assert.equal(results[0].status, 'rejected');
  assert.equal(results[0].reason?.status, 401);
  assert.equal(results[1].status, 'fulfilled');
  await currentCredentials(fixture, 'New-password-after-expiry');
  await rejectedToken(fixture.login.accessToken);
  assert.equal((await authService.verifyToken(results[1].value.accessToken)).staffId, fixture.staff.id);
});

test('a one-use Telegram invitation cannot be consumed twice on PostgreSQL', async () => {
  const fixture = await seedDirector('Single use director');
  const invite = await telegramLink.createInvite(fixture.staff.id);
  const token = new URL(invite.inviteUrl).searchParams.get('startapp').slice('staff_'.length);
  const results = await Promise.allSettled([
    telegramLink.confirmInvite({ token, initData: initData(900000102), password: oldPassword }),
    telegramLink.confirmInvite({ token, initData: initData(900000103), password: oldPassword }),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter((r) => r.status === 'rejected').length, 1);
  assert.equal((await repo.findOneByOrFail({ id: fixture.staff.id })).telegramId,
    results[0].status === 'fulfilled' ? '900000102' : '900000103');
  const response = results.find((result) => result.status === 'fulfilled').value;
  assert.equal((await authService.verifyToken(response.accessToken)).staffId, fixture.staff.id);
});
