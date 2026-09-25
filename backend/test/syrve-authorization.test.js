require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const { Test } = require('@nestjs/testing');
const { Reflector } = require('@nestjs/core');
const { UnauthorizedException, ValidationPipe } = require('@nestjs/common');
const { JwtAuthGuard } = require('../dist/auth/guards/jwt-auth.guard.js');
const { RolesGuard } = require('../dist/auth/guards/roles.guard.js');
const { SyrveIntegrationController } = require('../dist/syrve/syrve-integration.controller.js');
const { SyrveIntegrationService } = require('../dist/syrve/syrve-integration.service.js');

test('real JWT and role guards protect every Syrve route from non-Directors', async (t) => {
  let serviceCalls = 0;
  const service = Object.fromEntries(['getStatus', 'test', 'connect', 'recheck', 'updateMetadata', 'disconnect']
    .map((method) => [method, async () => { serviceCalls++; return { syncEnabled: false }; }]));
  const module = await Test.createTestingModule({
    controllers: [SyrveIntegrationController],
    providers: [{ provide: SyrveIntegrationService, useValue: service }],
  }).compile();
  const app = module.createNestApplication({ logger: false });
  const reflector = app.get(Reflector);
  app.useGlobalGuards(new JwtAuthGuard(reflector, {
    verifyToken: async (token) => {
      if (token === 'invalid') throw new UnauthorizedException();
      return { id: 'authenticated-test-user', role: token };
    },
  }), new RolesGuard(reflector));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(0, '127.0.0.1');
  t.after(() => app.close());
  const base = await app.getUrl();
  const input = { displayName: 'MOLO', apiBaseUrl: 'https://api-eu.syrve.live', apiLogin: 'test-only-login',
    organizationId: '11111111-2222-3333-4444-555555555555', organizationName: 'MOLO' };
  const routes = [['GET', '', null], ['POST', '/test', { displayName: input.displayName,
    apiBaseUrl: input.apiBaseUrl, apiLogin: input.apiLogin }], ['POST', '/connect', input],
    ['POST', '/recheck', {}], ['PATCH', '', { displayName: 'MOLO' }], ['POST', '/disconnect', {}]];
  for (const [method, path, body] of routes) {
    for (const [role, expected] of [[null, 401], ['invalid', 401], ['guest', 403],
      ['waiter', 403], ['hookah', 403], ['admin', 403], ['owner', method === 'POST' ? 201 : 200]]) {
      const before = serviceCalls;
      const response = await fetch(`${base}/syrve-integration${path}`, {
        method, headers: { 'Content-Type': 'application/json', ...(role ? { Authorization: `Bearer ${role}` } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      await response.text();
      assert.equal(response.status, expected, `${method} ${path} for ${role}`);
      assert.equal(serviceCalls - before, role === 'owner' ? 1 : 0);
    }
  }
});
