const assert = require('node:assert/strict');
const test = require('node:test');

const { AuthService } = require('../dist/auth/auth.service.js');
const { TelegramStaffLinkService } = require('../dist/staff/telegram-staff-link.service.js');

function makeStaff(role) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    telegramId: '123456789',
    fullName: role === 'owner' ? 'Директор MOLO' : 'Офіціант MOLO',
    role,
    active: true,
    isArchived: false,
    isOnShift: true,
    directorCredentialsConfiguredAt: new Date('2026-09-18T10:00:00.000Z'),
  };
}

async function issueInviteToken(staff) {
  const repository = {
    findOne: async ({ where }) => where.id === staff.id ? { ...staff } : null,
  };
  const jwt = {
    signAsync: async (payload) => JSON.stringify(payload),
    verifyAsync: async (token) => JSON.parse(token),
  };
  const linker = new TelegramStaffLinkService(repository, jwt, {});
  // Isolate the token issuer; existing staff-link tests cover invite locking
  // and credential checks. These stubs must not bypass verification in production.
  linker.verifyTelegramUser = () => ({ id: staff.telegramId });
  linker.resolveInvite = async () => ({ ...staff });
  linker.assertCredential = async () => staff.role === 'owner'
    ? staff.directorCredentialsConfiguredAt.getTime()
    : undefined;
  linker.consumeInviteAtomically = async () => ({ ...staff });
  const result = await linker.confirmInvite({ token: 'invite', initData: 'verified' });
  return { result, auth: new AuthService(repository, jwt) };
}

test('new Telegram link gives Director a usable versioned JWT and later revokes it', async () => {
  const director = makeStaff('owner');
  const { result, auth } = await issueInviteToken(director);
  assert.equal(result.user.directorSessionVersion, director.directorCredentialsConfiguredAt.getTime());
  assert.equal((await auth.verifyToken(result.accessToken)).role, 'owner');

  director.directorCredentialsConfiguredAt = new Date(director.directorCredentialsConfiguredAt.getTime() + 1);
  await assert.rejects(() => auth.verifyToken(result.accessToken), /Недійсний токен/);
});

test('staff Telegram link leaves waiter JWT unchanged', async () => {
  const waiter = makeStaff('waiter');
  const { result, auth } = await issueInviteToken(waiter);
  assert.equal(Object.hasOwn(result.user, 'directorSessionVersion'), false);
  assert.equal((await auth.verifyToken(result.accessToken)).role, 'waiter');
});
