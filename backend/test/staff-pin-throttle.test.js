const assert = require('node:assert/strict');
const test = require('node:test');
const { UnauthorizedException } = require('@nestjs/common');

const { StaffController } = require('../dist/staff/staff.controller.js');

const STAFF_ID = '11111111-1111-4111-8111-111111111111';

function createController({ loginWithPin, confirmInvite } = {}) {
  let loginCalls = 0;
  let telegramCalls = 0;

  const service = {
    loginWithPin: async (dto) => {
      loginCalls += 1;
      if (loginWithPin) return loginWithPin(dto);
      throw new UnauthorizedException('Невірний працівник або PIN');
    },
  };

  const permissions = {};
  const telegramLinks = {
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
  const lowerCaseId = 'abcdefab-cdef-4abc-8def-abcdefabcdef';
  const upperCaseId = lowerCaseId.toUpperCase();

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    await assert.rejects(
      () =>
        controller.loginWithPin({
          staffId: attempt % 2 ? lowerCaseId : upperCaseId,
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
    () => controller.loginWithPin({ staffId: lowerCaseId, pin: '0000' }),
    /Повторіть через/,
  );
  assert.equal(getLoginCalls(), 5);
});

test('full attempt map admits an unseen employee without growing', async () => {
  const { controller, getLoginCalls } = createController({
    loginWithPin: async () => ({ accessToken: 'test-token' }),
  });
  const now = Date.now();

  for (let index = 0; index < 10_000; index += 1) {
    controller.pinAttempts.set(`key-${index}`, {
      failedAttempts: 1,
      windowStartedAt: now,
      lockedUntil: null,
    });
  }

  await controller.loginWithPin({ staffId: STAFF_ID, pin: '0000' });

  assert.equal(getLoginCalls(), 1);
  assert.equal(controller.pinAttempts.size, 9_999);
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
