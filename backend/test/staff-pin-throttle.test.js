const assert = require('node:assert/strict');
const test = require('node:test');
const { UnauthorizedException } = require('@nestjs/common');

const { StaffController } = require('../dist/staff/staff.controller.js');

const STAFF_ID = '11111111-1111-4111-8111-111111111111';
const CASE_STAFF_ID = 'abcdefab-cdef-4abc-8def-abcdefabcdef';

function createController({
  loginWithPin,
  confirmInvite,
  loginOptions,
  getInviteInfo,
} = {}) {
  let loginCalls = 0;
  let telegramCalls = 0;
  let inviteInfoCalls = 0;

  const service = {
    findActiveForLogin: async () =>
      loginOptions || [
        { id: STAFF_ID, role: 'waiter' },
        { id: CASE_STAFF_ID, role: 'waiter' },
      ],
    loginWithPin: async (dto) => {
      loginCalls += 1;
      if (loginWithPin) return loginWithPin(dto);
      throw new UnauthorizedException('Невірний працівник або PIN');
    },
  };

  const permissions = {};
  const telegramLinks = {
    getInviteInfo: async (token) => {
      inviteInfoCalls += 1;
      if (getInviteInfo) return getInviteInfo(token);
      return {
        fullName: 'Test Staff',
        role: 'waiter',
        authType: 'pin',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      };
    },
    confirmInvite: async (dto) => {
      telegramCalls += 1;
      if (confirmInvite) return confirmInvite(dto);
      throw new UnauthorizedException('Невірний PIN');
    },
  };

  return {
    controller: new StaffController(service, permissions, telegramLinks),
    getLoginCalls: () => loginCalls,
    getTelegramCalls: () => telegramCalls,
    getInviteInfoCalls: () => inviteInfoCalls,
  };
}

test('staff PIN login locks after five wrong attempts', async () => {
  const { controller, getLoginCalls } = createController();
  const dto = { staffId: STAFF_ID, pin: '0000' };

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    await assert.rejects(() => controller.loginWithPin(dto), /Невірний працівник або PIN/);
  }

  await assert.rejects(() => controller.loginWithPin(dto), /заблоковано на 15 хв/);
  await assert.rejects(() => controller.loginWithPin(dto), /Повторіть через/);
  assert.equal(getLoginCalls(), 5);
});

test('concurrent PIN guesses are serialized per employee', async () => {
  const { controller, getLoginCalls } = createController();
  const dto = { staffId: STAFF_ID, pin: '0000' };

  const results = await Promise.allSettled(
    Array.from({ length: 6 }, () => controller.loginWithPin(dto)),
  );

  assert.equal(results.every((result) => result.status === 'rejected'), true);
  assert.equal(getLoginCalls(), 5);
});

test('staff UUID casing cannot create separate PIN attempt buckets', async () => {
  const { controller, getLoginCalls } = createController();
  const upperCaseId = CASE_STAFF_ID.toUpperCase();

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    await assert.rejects(
      () =>
        controller.loginWithPin({
          staffId: attempt % 2 ? CASE_STAFF_ID : upperCaseId,
          pin: '0000',
        }),
      /Невірний працівник або PIN/,
    );
  }

  await assert.rejects(
    () => controller.loginWithPin({ staffId: upperCaseId, pin: '0000' }),
    /заблоковано на 15 хв/,
  );
  await assert.rejects(
    () => controller.loginWithPin({ staffId: CASE_STAFF_ID, pin: '0000' }),
    /Повторіть через/,
  );
  assert.equal(getLoginCalls(), 5);
});

test('unknown staff IDs do not allocate PIN attempt state', async () => {
  const { controller, getLoginCalls } = createController({ loginOptions: [] });

  for (let index = 0; index < 100; index += 1) {
    const suffix = String(index).padStart(12, '0');
    await assert.rejects(
      () =>
        controller.loginWithPin({
          staffId: `00000000-0000-4000-8000-${suffix}`,
          pin: '0000',
        }),
      /Невірний працівник або PIN/,
    );
  }

  assert.equal(getLoginCalls(), 100);
  assert.equal(controller.pinAttempts.size, 0);
});

test('different known employees keep isolated PIN counters', async () => {
  const secondStaffId = '22222222-2222-4222-8222-222222222222';
  const { controller, getLoginCalls } = createController({
    loginOptions: [
      { id: STAFF_ID, role: 'waiter' },
      { id: secondStaffId, role: 'waiter' },
    ],
  });

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    await assert.rejects(
      () => controller.loginWithPin({ staffId: STAFF_ID, pin: '0000' }),
      /Невірний працівник або PIN/,
    );
    await assert.rejects(
      () => controller.loginWithPin({ staffId: secondStaffId, pin: '0000' }),
      /Невірний працівник або PIN/,
    );
  }

  await assert.rejects(
    () => controller.loginWithPin({ staffId: STAFF_ID, pin: '0000' }),
    /заблоковано на 15 хв/,
  );
  await assert.rejects(
    () => controller.loginWithPin({ staffId: secondStaffId, pin: '0000' }),
    /заблоковано на 15 хв/,
  );
  assert.equal(getLoginCalls(), 10);
});

test('Telegram staff-link PIN uses the same five-attempt lockout', async () => {
  const { controller, getTelegramCalls } = createController();
  const dto = { token: 'staff_test-token', initData: 'test', pin: '0000' };

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    await assert.rejects(() => controller.confirmTelegramLink(dto), /Невірний PIN/);
  }

  await assert.rejects(() => controller.confirmTelegramLink(dto), /заблоковано на 15 хв/);
  assert.equal(getTelegramCalls(), 5);
});

test('equivalent Telegram invite token forms share one PIN attempt bucket', async () => {
  const { controller, getTelegramCalls } = createController();
  const tokenForms = [
    'test-token',
    ' staff_test-token',
    'staff_test-token ',
    ' test-token ',
  ];

  for (const token of tokenForms) {
    await assert.rejects(
      () => controller.confirmTelegramLink({ token, initData: 'test', pin: '0000' }),
      /Невірний PIN/,
    );
  }

  await assert.rejects(
    () =>
      controller.confirmTelegramLink({
        token: 'staff_test-token',
        initData: 'test',
        pin: '0000',
      }),
    /заблоковано на 15 хв/,
  );
  await assert.rejects(
    () =>
      controller.confirmTelegramLink({
        token: 'test-token',
        initData: 'test',
        pin: '0000',
      }),
    /Повторіть через/,
  );
  assert.equal(getTelegramCalls(), 5);
});

test('invalid Telegram invite tokens do not allocate PIN attempt state', async () => {
  const { controller, getTelegramCalls, getInviteInfoCalls } = createController({
    getInviteInfo: async () => {
      throw new UnauthorizedException('Посилання для прив’язки недійсне');
    },
  });

  for (let index = 0; index < 100; index += 1) {
    await assert.rejects(
      () =>
        controller.confirmTelegramLink({
          token: `invalid-token-${index}`,
          initData: 'test',
          pin: '0000',
        }),
      /Посилання для прив’язки недійсне/,
    );
  }

  assert.equal(getInviteInfoCalls(), 100);
  assert.equal(getTelegramCalls(), 0);
  assert.equal(controller.pinAttempts.size, 0);
});

test('different valid Telegram invites keep isolated PIN counters', async () => {
  const { controller, getTelegramCalls } = createController();
  const first = { token: 'staff_first-token', initData: 'test', pin: '0000' };
  const second = { token: 'staff_second-token', initData: 'test', pin: '0000' };

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    await assert.rejects(() => controller.confirmTelegramLink(first), /Невірний PIN/);
    await assert.rejects(() => controller.confirmTelegramLink(second), /Невірний PIN/);
  }

  await assert.rejects(
    () => controller.confirmTelegramLink(first),
    /заблоковано на 15 хв/,
  );
  await assert.rejects(
    () => controller.confirmTelegramLink(second),
    /заблоковано на 15 хв/,
  );
  assert.equal(getTelegramCalls(), 10);
});
