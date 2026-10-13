require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const { JwtService } = require('@nestjs/jwt');
const { Reflector } = require('@nestjs/core');
const { Test } = require('@nestjs/testing');
const { ValidationPipe } = require('@nestjs/common');
const { validate } = require('class-validator');
const { AuthService } = require('../dist/auth/auth.service');
const { JwtAuthGuard } = require('../dist/auth/guards/jwt-auth.guard');
const { RolesGuard } = require('../dist/auth/guards/roles.guard');
const { DeveloperController } = require('../dist/developer/developer.controller');
const { DeveloperService } = require('../dist/developer/developer.service');
const { DeveloperLoginThrottle } = require('../dist/developer/developer-login-throttle');
const { readDeveloperAccess, DEVELOPER_TOKEN_AUDIENCE, DEVELOPER_TOKEN_ISSUER } = require('../dist/developer/developer-access');
const { CreateStaffDto } = require('../dist/staff/dto/create-staff.dto');
const { UpdateStaffDto } = require('../dist/staff/dto/update-staff.dto');

const password = 'test-only-developer-password-2026';
const passwordHash = bcrypt.hashSync(password, 12);
const config = {
  NODE_ENV: 'test', JWT_SECRET: 'test-only-staff-signing-secret',
  DEVELOPER_ACCESS_ENABLED: 'true', DEVELOPER_LOGIN: 'test-developer',
  DEVELOPER_PASSWORD_HASH: passwordHash, RENDER_GIT_COMMIT: 'a'.repeat(40),
};
const original = Object.fromEntries(Object.keys(config).map(key => [key, process.env[key]]));
test.beforeEach(() => Object.assign(process.env, config));
test.after(() => {
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

function fixture() {
  const jwt = new JwtService({ secret: config.JWT_SECRET });
  let staffReads = 0;
  const auth = new AuthService({ async findOne({ where }) {
    staffReads++;
    return { id: where.id, role: where.id, fullName: 'Test staff', active: true,
      isArchived: false, isOnShift: true, directorSessionVersion: 0 };
  } }, jwt);
  return { jwt, auth, service: new DeveloperService(jwt, new DeveloperLoginThrottle()),
    staffReads: () => staffReads };
}
function login(f) { return f.service.login({ login: config.DEVELOPER_LOGIN, password }, 'test-address'); }

test('optional developer access fails closed for missing, disabled and unsafe configuration', () => {
  assert.ok(readDeveloperAccess(config));
  for (const changed of [
    { DEVELOPER_ACCESS_ENABLED: undefined }, { DEVELOPER_ACCESS_ENABLED: 'false' },
    { DEVELOPER_ACCESS_ENABLED: 'TRUE' }, { DEVELOPER_LOGIN: '' },
    { DEVELOPER_LOGIN: '../owner' }, { DEVELOPER_PASSWORD_HASH: '' },
    { DEVELOPER_PASSWORD_HASH: password },
    { DEVELOPER_PASSWORD_HASH: passwordHash.replace('$12$', '$04$') },
    { DEVELOPER_PASSWORD_HASH: passwordHash.replace('$12$', '$31$') },
  ]) assert.equal(readDeveloperAccess({ ...config, ...changed }), null);
});

test('successful login uses an isolated short-lived key and never reads Staff or returns credentials', async () => {
  const f = fixture(); const result = await login(f);
  assert.equal(result.user.role, 'developer');
  assert.equal(result.version, 'aaaaaaa');
  const claims = f.jwt.decode(result.accessToken);
  assert.equal(claims.exp - claims.iat, 900);
  assert.equal(claims.aud, DEVELOPER_TOKEN_AUDIENCE);
  assert.equal(claims.iss, DEVELOPER_TOKEN_ISSUER);
  assert.equal(claims.staffId, null);
  assert.equal((await f.auth.verifyToken(result.accessToken)).role, 'developer');
  assert.equal(f.staffReads(), 0);
  await assert.rejects(() => f.jwt.verifyAsync(result.accessToken, { secret: config.JWT_SECRET }));
  for (const secret of [password, passwordHash, config.DEVELOPER_LOGIN, readDeveloperAccess().signingKey]) {
    assert.ok(!JSON.stringify(claims).includes(secret));
    assert.ok(!JSON.stringify(result).includes(secret));
  }
});

test('wrong credentials produce the same error and staff PINs do not establish developer access', async () => {
  const f = fixture();
  for (const dto of [
    { login: 'other-developer', password },
    { login: config.DEVELOPER_LOGIN, password: 'incorrect-test-password' },
  ]) await assert.rejects(() => f.service.login(dto, 'test-address'), error =>
    error.getStatus() === 401 && error.message === 'Невірні дані входу.');
  await assert.rejects(() => f.service.login({ login: config.DEVELOPER_LOGIN, password: 'я'.repeat(37) }, 'test-address'),
    error => error.getStatus() === 400);
  assert.equal(f.staffReads(), 0);
});

test('disablement, credential rotation and JWT root rotation revoke existing developer sessions', async () => {
  const f = fixture(); const result = await login(f);
  for (const [key, value] of [
    ['DEVELOPER_ACCESS_ENABLED', 'false'], ['DEVELOPER_LOGIN', 'changed-developer'],
    ['DEVELOPER_PASSWORD_HASH', bcrypt.hashSync(password, 12)],
    ['JWT_SECRET', 'changed-test-only-root-secret'],
  ]) {
    process.env[key] = value;
    await assert.rejects(() => f.auth.verifyToken(result.accessToken), error => error.getStatus() === 401);
    process.env[key] = config[key];
  }
  assert.equal((await f.auth.verifyToken(result.accessToken)).role, 'developer');
  process.env.DEVELOPER_ACCESS_ENABLED = 'false';
  await assert.rejects(() => login(f), error => error.getStatus() === 503);
});

test('staff-signed developer roles and malformed developer tokens are rejected', async () => {
  const f = fixture();
  const base = { sub: 'developer', role: 'developer', staffId: null, telegramId: '' };
  const staffSigned = f.jwt.sign(base);
  await assert.rejects(() => f.auth.verifyToken(staffSigned), error => error.getStatus() === 401);
  const now = Math.floor(Date.now() / 1000);
  for (const [changed, options] of [
    [{ role: 'owner' }, {}], [{ staffId: 'owner' }, {}], [{ sub: 'owner' }, {}],
    [{ telegramId: 'owner' }, {}], [{}, { audience: 'wrong-audience' }],
    [{}, { issuer: 'wrong-issuer' }], [{}, { expiresIn: 901 }],
    [{}, { expiresIn: -1 }], [{ iat: now + 60 }, {}],
  ]) {
    const token = f.jwt.sign({ ...base, ...changed }, {
      secret: readDeveloperAccess().signingKey, algorithm: 'HS256', expiresIn: 900,
      audience: DEVELOPER_TOKEN_AUDIENCE, issuer: DEVELOPER_TOKEN_ISSUER, ...options,
    });
    await assert.rejects(() => f.auth.verifyToken(token), error => error.getStatus() === 401);
  }
  assert.equal(f.staffReads(), 0);
});

test('concurrent login attempts are reserved before password hashing begins', async () => {
  const f = fixture();
  const results = await Promise.allSettled(Array.from({ length: 7 }, () =>
    f.service.login({ login: config.DEVELOPER_LOGIN, password: 'incorrect-test-password' }, 'same-address')));
  const statuses = results.map(result => result.reason.getStatus());
  assert.equal(statuses.filter(status => status === 401).length, 5);
  assert.equal(statuses.filter(status => status === 429).length, 2);
});

test('throttling has address and global bounds, expires naturally and rejects new identities when full', () => {
  const limiter = new DeveloperLoginThrottle();
  const at = 1_000_000;
  for (let i = 0; i < 20; i++) limiter.reserve(`address-${i}`, at);
  assert.throws(() => limiter.reserve('new-address', at), error => error.getStatus() === 429);
  limiter.reserve('new-address', at + 60_001);
  for (let i = 0; i < 4; i++) limiter.reserve('same-address', at + 60_001);
  limiter.reserve('same-address', at + 60_001);
  assert.throws(() => limiter.reserve('same-address', at + 60_001), error => error.getStatus() === 429);
  limiter.reserve('same-address', at + 960_002);
  const bounded = new DeveloperLoginThrottle();
  for (let i = 0; i < 200; i++) bounded.reserve(`bounded-${i}`, at + Math.floor(i / 20) * 60_001);
  assert.throws(() => bounded.reserve('one-more', at + 600_010), error => error.getStatus() === 429);
});

test('Director create/update Staff DTOs cannot assign the developer role', async () => {
  for (const Dto of [CreateStaffDto, UpdateStaffDto]) {
    const input = Object.assign(new Dto(), { fullName: 'Test staff', role: 'developer' });
    assert.ok((await validate(input)).some(error => error.property === 'role'));
  }
});

test('real HTTP guards deny unauthenticated and staff access to the developer session', async (t) => {
  const f = fixture();
  const module = await Test.createTestingModule({ controllers: [DeveloperController],
    providers: [{ provide: DeveloperService, useValue: f.service }] }).compile();
  const app = module.createNestApplication({ logger: false });
  const reflector = app.get(Reflector);
  app.useGlobalGuards(new JwtAuthGuard(reflector, f.auth), new RolesGuard(reflector));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(0, '127.0.0.1'); t.after(() => app.close());
  const base = await app.getUrl();
  const post = body => fetch(`${base}/developer/login`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const correct = { login: config.DEVELOPER_LOGIN, password };
  const response = await post(correct);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const result = await response.json();
  for (const [token, expected] of [[null, 401], ['malformed', 401], [result.accessToken, 200],
    ...['guest', 'waiter', 'hookah', 'admin', 'owner'].map(role => [f.jwt.sign({
      sub: role, telegramId: '', staffId: role === 'guest' ? null : role, role,
      ...(role === 'owner' ? { directorSessionVersion: 0 } : {}),
    }), 403])]) {
    const session = await fetch(`${base}/developer/session`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    assert.equal(session.status, expected);
    if (expected === 200) {
      assert.equal(session.headers.get('cache-control'), 'no-store');
      const view = await session.json();
      assert.equal(view.user.role, 'developer');
      assert.ok(!JSON.stringify(view).includes('accessToken'));
    } else await session.text();
  }
  for (const body of [{ ...correct, role: 'owner' }, { ...correct, password: '123456' }, { ...correct, login: '../owner' }]) {
    assert.equal((await post(body)).status, 400);
  }
  process.env.DEVELOPER_ACCESS_ENABLED = 'false';
  assert.equal((await post(correct)).status, 503);
  const revoked = await fetch(`${base}/developer/session`, { headers: { Authorization: `Bearer ${result.accessToken}` } });
  assert.equal(revoked.status, 401);
});

test('developer sessions have no access to any existing role-protected controller action', () => {
  const reflector = new Reflector(); const guard = new RolesGuard(reflector);
  let checked = 0;
  function visit(directory) {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, item.name);
      if (item.isDirectory()) visit(file);
      else if (item.name.endsWith('.controller.js')) {
        for (const controller of Object.values(require(file))) {
          if (typeof controller !== 'function') continue;
          for (const name of Object.getOwnPropertyNames(controller.prototype)) {
            const handler = controller.prototype[name];
            if (typeof handler !== 'function') continue;
            const roles = reflector.getAllAndOverride('roles', [handler, controller]);
            const isPublic = reflector.getAllAndOverride('isPublic', [handler, controller]);
            if (!roles?.length || isPublic || roles.includes('developer')) continue;
            const context = { getHandler: () => handler, getClass: () => controller,
              switchToHttp: () => ({ getRequest: () => ({ user: { role: 'developer' } }) }) };
            assert.throws(() => guard.canActivate(context), error => error.getStatus() === 403, `${controller.name}.${name}`);
            checked++;
          }
        }
      }
    }
  }
  visit(path.resolve(__dirname, '../dist'));
  assert.ok(checked > 100, `checked ${checked} existing protected actions`);
});
