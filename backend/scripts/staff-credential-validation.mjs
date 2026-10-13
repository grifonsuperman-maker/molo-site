import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { assertFreshSchemaReferenceTarget, lockFreshSchemaReferenceEnvironment } from './fresh-schema-reference.mjs';

const ROLLBACK = new Error('STAFF_CREDENTIAL_CI_ROLLBACK');

export async function runStaffCredentialValidation(env = process.env) {
  assertFreshSchemaReferenceTarget(env);
  if (env !== process.env) throw new Error('Staff credential validation must use the validated process environment.');
  lockFreshSchemaReferenceEnvironment(env);
  const require = createRequire(import.meta.url);
  const { DataSource } = require('typeorm');
  const { hash } = require('bcryptjs');
  const { JwtService } = require('@nestjs/jwt');
  const { resolveJwtSecret } = require('../dist/config/runtime-secrets.js');
  const { AuthService } = require('../dist/auth/auth.service.js');
  const { StaffService } = require('../dist/staff/staff.service.js');
  const { TelegramStaffLinkService } = require('../dist/staff/telegram-staff-link.service.js');
  const { Staff } = require('../dist/staff/entities/staff.entity.js');
  const { StaffShiftEvent } = require('../dist/staff/entities/staff-shift-event.entity.js');
  const { LogsService } = require('../dist/logs/logs.service.js');
  const { Log } = require('../dist/logs/entities/log.entity.js');
  const { BroadcastsService } = require('../dist/broadcasts/broadcasts.service.js');
  const { Broadcast } = require('../dist/broadcasts/entities/broadcast.entity.js');
  const { STAFF_WITH_CREDENTIALS_SELECT } = require('../dist/staff/staff-credential-selection.js');
  const source = new DataSource({
    type: 'postgres', host: env.DB_HOST, port: Number(env.DB_PORT || 5432),
    username: env.DB_USER || 'postgres', password: env.DB_PASSWORD || 'postgres', database: env.DB_NAME,
    synchronize: false, entities: [resolve(dirname(fileURLToPath(import.meta.url)), '../dist/**/*.entity.js')],
    extra: { connectionTimeoutMillis: 5000, statement_timeout: 10000 },
  });
  const assertPrivate = (value) => assert.doesNotMatch(JSON.stringify(value),
    /"(?:pinHash|directorPasswordHash|directorLoginName|directorCredentialsConfiguredAt|directorFailedLoginAttempts|directorLockedUntil|telegramInviteTokenHash)":/);
  await source.initialize();
  const previousBotToken = env.TELEGRAM_BOT_TOKEN;
  env.TELEGRAM_BOT_TOKEN = 'synthetic-credential-ci-bot';
  const initData = (id) => {
    const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id, first_name: 'CI' }) });
    const checked = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('\n');
    const secret = createHmac('sha256', 'WebAppData').update(env.TELEGRAM_BOT_TOKEN).digest();
    params.set('hash', createHmac('sha256', secret).update(checked).digest('hex'));
    return params.toString();
  };
  try {
    await assert.rejects(source.transaction(async (manager) => {
      const staff = manager.getRepository(Staff);
      const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
      const loginName = `ci_${suffix}`;
      const pin = '5246';
      const password = 'Synthetic-CI-password';
      const waiter = await staff.save(staff.create({ fullName: `CI waiter ${suffix}`, role: 'waiter', isOnShift: true, pinHash: await hash(pin, 4) }));
      const director = await staff.save(staff.create({ fullName: `CI Director ${suffix}`, role: 'owner',
        pinHash: await hash(pin, 4), directorLoginName: loginName, directorPasswordHash: await hash(password, 4),
        directorCredentialsConfiguredAt: new Date(),
      }));
      const bootstrap = await staff.save(staff.create({ fullName: `CI bootstrap ${suffix}`, role: 'owner' }));
      const jwt = new JwtService({ secret: resolveJwtSecret() });
      const auth = new AuthService(staff, jwt);
      const service = new StaffService(staff, manager.getRepository(StaffShiftEvent), jwt);
      const added = await service.create({ fullName: `CI added ${suffix}`, role: 'admin', pin });
      assert.equal(added.hasPin, true);
      assertPrivate(added);
      assert.equal((await service.loginWithPin({ staffId: added.id, pin })).user.role, 'admin');
      const logs = new LogsService(manager.getRepository(Log));
      const broadcasts = new BroadcastsService(manager.getRepository(Broadcast), {}, logs, {});
      for (const employee of [waiter, director]) {
        await logs.create('CI credential projection', { id: employee.id });
        await manager.getRepository(Broadcast).save({ message: 'CI credential projection', createdByStaff: { id: employee.id } });
        const ordinary = await staff.findOneByOrFail({ id: employee.id });
        assertPrivate(ordinary);
        assert.equal(ordinary.fullName, employee.fullName);
      }
      assertPrivate(await logs.findAll());
      const active = await logs.findActive();
      assertPrivate(active);
      const archived = active.items.find((item) => item.staff?.id === director.id);
      assert.ok(archived);
      await logs.archive(archived.id);
      assertPrivate(await logs.findArchive());
      assertPrivate(await broadcasts.findAll());
      const publicStaff = await service.findAll();
      assertPrivate(publicStaff);
      assert.equal(publicStaff.find((item) => item.id === waiter.id).hasPin, true);
      assert.equal(publicStaff.find((item) => item.id === director.id).hasDirectorAccess, true);
      assert.equal(publicStaff.find((item) => item.id === bootstrap.id).hasDirectorAccess, false);
      const accessStatus = await service.getDirectorAccessStatus();
      assert.equal(accessStatus.directors.find((item) => item.id === director.id).configured, true);
      assert.equal(accessStatus.directors.find((item) => item.id === bootstrap.id).configured, false);
      assertPrivate(accessStatus);

      const pinLogin = await service.loginWithPin({ staffId: waiter.id, pin });
      assertPrivate(pinLogin);
      assert.equal((await auth.verifyToken(pinLogin.accessToken)).role, 'waiter');
      await assert.rejects(service.loginWithPin({ staffId: waiter.id, pin: '0000' }), /Невірний працівник або PIN/);
      const initial = await service.loginDirector({ staffId: bootstrap.id, temporaryPin: '1111' });
      assert.equal(initial.mustConfigureDirectorAccess, true);
      await assert.rejects(service.loginDirector({ loginName, password: 'wrong' }), /Невірне ім’я або пароль/);
      const failedDirector = await staff.findOne({ select: STAFF_WITH_CREDENTIALS_SELECT, where: { id: director.id } });
      assert.equal(failedDirector.directorFailedLoginAttempts, 1);
      const directorLogin = await service.loginDirector({ loginName, password });
      assertPrivate(directorLogin);
      assert.equal((await auth.verifyToken(directorLogin.accessToken)).role, 'owner');
      assert.equal((await service.getDirectorAccess(directorLogin.user)).loginName, loginName);

      // Fake transport: no invitations or messages are sent to real people.
      const linking = new TelegramStaffLinkService(staff, jwt, { async getBotUsername() { return 'synthetic_ci_bot'; } });
      for (const [employee, credential, id] of [[waiter, { pin }, 920000000001], [director, { password }, 920000000002]]) {
        const invitation = await linking.createInvite(employee.id);
        const token = new URL(invitation.inviteUrl).searchParams.get('startapp').slice('staff_'.length);
        assertPrivate(await linking.getInviteInfo(token));
        if (employee.role === 'owner') {
          await assert.rejects(linking.confirmInvite({ token, initData: initData(id), password: 'wrong' }),
            /Невірні дані входу.*Залишилось спроб: 4/);
        }
        const linked = await linking.confirmInvite({ token, initData: initData(id), ...credential });
        assertPrivate(linked);
        assert.equal((await auth.verifyToken(linked.accessToken)).role, employee.role);
        const telegramLogin = await auth.authenticateTelegram({ initData: initData(id) });
        assert.equal((await auth.verifyToken(telegramLogin.accessToken)).role, employee.role);
      }
      await service.updateDirectorAccess(directorLogin.user, {
        fullName: director.fullName, loginName, currentPassword: password,
        newPassword: 'Synthetic-CI-next-password', confirmPassword: 'Synthetic-CI-next-password',
      });
      await assert.rejects(auth.verifyToken(directorLogin.accessToken), /Недійсний токен/);
      const fresh = await service.loginDirector({ loginName, password: 'Synthetic-CI-next-password' });
      assert.equal((await auth.verifyToken(fresh.accessToken)).role, 'owner');
      throw ROLLBACK;
    }), (error) => error === ROLLBACK);
  } finally {
    env.TELEGRAM_BOT_TOKEN = previousBotToken;
    await source.destroy();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runStaffCredentialValidation()
    .then(() => process.stdout.write('Staff credential PostgreSQL validation passed.\n'))
    .catch((error) => { console.error(`Staff credential validation failed: ${error.message}`); process.exitCode = 1; });
}
