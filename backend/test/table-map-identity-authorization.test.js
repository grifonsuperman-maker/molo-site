require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const { Test } = require('@nestjs/testing');
const { Reflector } = require('@nestjs/core');
const { UnauthorizedException } = require('@nestjs/common');
const { JwtAuthGuard } = require('../dist/auth/guards/jwt-auth.guard.js');
const { RolesGuard } = require('../dist/auth/guards/roles.guard.js');
const { TablesController } = require('../dist/tables/tables.controller.js');
const { TablesService } = require('../dist/tables/tables.service.js');

test('real JWT/role guards restrict identity diagnostics to the Director, preserving public tables', async (t) => {
  let diagnosticsCalls = 0;
  const module = await Test.createTestingModule({
    controllers: [TablesController],
    providers: [{ provide: TablesService, useValue: {
      findAll: async () => [],
      getMapIdentityDiagnostics: async () => { diagnosticsCalls++; return { prepared: false, syncEnabled: false }; },
    } }],
  }).compile();
  const app = module.createNestApplication({ logger: false });
  const reflector = app.get(Reflector);
  app.useGlobalGuards(new JwtAuthGuard(reflector, { verifyToken: async (token) => {
    if (token === 'invalid') throw new UnauthorizedException();
    return { id: 'test-user', role: token };
  } }), new RolesGuard(reflector));
  await app.listen(0, '127.0.0.1');
  t.after(() => app.close());
  const base = await app.getUrl();
  const publicResponse = await fetch(base + '/tables');
  assert.equal(publicResponse.status, 200);
  await publicResponse.text();
  for (const [role, status] of [[null, 401], ['invalid', 401], ['guest', 403], ['waiter', 403],
    ['hookah', 403], ['admin', 403], ['owner', 200]]) {
    const before = diagnosticsCalls;
    const response = await fetch(base + '/tables/map-identities', {
      headers: role ? { Authorization: 'Bearer ' + role } : {},
    });
    await response.text();
    assert.equal(response.status, status, String(role));
    assert.equal(diagnosticsCalls - before, role === 'owner' ? 1 : 0);
    if (role === 'owner') assert.equal(response.headers.get('cache-control'), 'no-store');
  }
});
