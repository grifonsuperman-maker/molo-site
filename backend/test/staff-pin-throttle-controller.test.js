const assert = require('node:assert/strict');
const test = require('node:test');
const { UnauthorizedException } = require('@nestjs/common');

const { StaffController } = require('../dist/staff/staff.controller.js');

const STAFF_ID = 'abcdefab-cdef-4abc-8def-abcdefabcdef';

function createController({ role = 'waiter', inviteAuthType = 'pin' } = {}) {
  const executions = [];
  let loginCalls = 0;
  let telegramCalls = 0;

  const service = {
    findActiveForLogin: async () => [
      {
        id: STAFF_ID,
        role,
        fullName: 'Test Staff',
        isOnShift: true,
      },
    ],
    loginWithPin: async () => {
      loginCalls += 1;
      throw new UnauthorizedException('Невірний працівник або PIN');
    },
  };

  const telegramLinks = {
    getInviteInfo: async () => ({
      fullName: 'Test Staff',
      role,
      authType: inviteAuthType,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }),
    confirmInvite: async () => {
      telegramCalls += 1;
      throw new UnauthorizedException(
        inviteAuthType === 'pin' ? 'Невірний PIN' : 'Невірні дані входу',
      );
    },
  };

  const pinThrottle = {
    execute: async (options) => {
      executions.push(options);
      return options.action();
    },
  };

  return {
    controller: new StaffController(service, {}, telegramLinks, pinThrottle),
    executions,
    getLoginCalls: () => loginCalls,
    getTelegramCalls: () => telegramCalls,
  };
}

test('staff UUID casing maps to one persistent throttle subject', async () => {
  const { controller, executions } = createController();

  await assert.rejects(
    () =>
      controller.loginWithPin({
        staffId: STAFF_ID.toUpperCase(),
        pin: '0000',
      }),
    /Невірний працівник або PIN/,
  );

  assert.equal(executions.length, 1);
  assert.equal(executions[0].scope, 'pin-login');
  assert.equal(executions[0].subject, STAFF_ID);
});

test('unknown staff IDs bypass persistent storage and keep the existing error path', async () => {
  const { controller, executions, getLoginCalls } = createController();

  await assert.rejects(
    () =>
      controller.loginWithPin({
        staffId: '11111111-1111-4111-8111-111111111111',
        pin: '0000',
      }),
    /Невірний працівник або PIN/,
  );

  assert.equal(executions.length, 0);
  assert.equal(getLoginCalls(), 1);
});

test('equivalent Telegram invite token forms map to one throttle subject', async () => {
  const first = createController();
  const second = createController();

  await assert.rejects(
    () =>
      first.controller.confirmTelegramLink({
        token: ' staff_test-token ',
        initData: 'test',
        pin: '0000',
      }),
    /Невірний PIN/,
  );

  await assert.rejects(
    () =>
      second.controller.confirmTelegramLink({
        token: 'test-token',
        initData: 'test',
        pin: '0000',
      }),
    /Невірний PIN/,
  );

  assert.equal(first.executions[0].subject, 'test-token');
  assert.equal(second.executions[0].subject, 'test-token');
});

test('Director Telegram confirmation keeps the existing Director protection only', async () => {
  const { controller, executions, getTelegramCalls } = createController({
    role: 'owner',
    inviteAuthType: 'director_password',
  });

  await assert.rejects(
    () =>
      controller.confirmTelegramLink({
        token: 'staff_director-token',
        initData: 'test',
        password: 'wrong-password',
      }),
    /Невірні дані входу/,
  );

  assert.equal(executions.length, 0);
  assert.equal(getTelegramCalls(), 1);
});
