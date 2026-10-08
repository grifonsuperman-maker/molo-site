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
const { SyrveReadinessService } = require('../dist/syrve/syrve-readiness.service.js');
const {SyrveActivationService}=require('../dist/syrve/syrve-activation.service.js');
const { SyrveTableLoadingService } = require('../dist/syrve/syrve-table-loading.service.js');
const { SyrveOperationsService } = require('../dist/syrve/syrve-operations.service.js');
const { AuthService } = require('../dist/auth/auth.service.js');

test('real JWT and role guards protect every Syrve route from non-Directors', async (t) => {
  let serviceCalls = 0;
  const service = Object.fromEntries(['getStatus', 'test', 'previewTables', 'observeOrders', 'orderDiagnostics', 'billDiagnostics', 'connect', 'recheck', 'updateMetadata', 'disconnect']
    .map((method) => [method, async () => { serviceCalls++; return { syncEnabled: false }; }]));
  const module = await Test.createTestingModule({
    controllers: [SyrveIntegrationController],
    providers: [{ provide: SyrveIntegrationService, useValue: service },
      {provide:SyrveReadinessService,useValue:{read:async()=>{serviceCalls++;return {syncEnabled:false};}}},
      {provide:SyrveActivationService,useValue:{status:service.getStatus,preview:service.getStatus,enable:service.getStatus,disable:service.getStatus}},
      {provide:SyrveTableLoadingService,useValue:{preview:service.getStatus,load:service.getStatus}},
      {provide:SyrveOperationsService,useValue:{start:async(actor,kind,action)=>action(),read:service.getStatus}},
      {provide:AuthService,useValue:{verifyToken:async()=>({role:'owner'})}}],
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
    organizationId: '11111111-2222-4333-8444-555555555555', organizationName: 'MOLO', confirmationProof: 'test-confirmation-proof'.repeat(3), pairs: [] };
  const revision = { configurationRevision: '11111111-2222-4333-8444-555555555555' };
  const routes = [['GET','/operations/11111111-2222-4333-8444-555555555555',null],['GET','/auto-status',null],['POST','/auto-status-preview',revision],
    ['POST','/enable-auto-status',{...revision,confirmationProof:input.confirmationProof,confirmed:true}],['POST','/disable-auto-status',revision],['GET', '', null], ['GET','/readiness',null], ['POST', '/test', { displayName: input.displayName,
    apiBaseUrl: input.apiBaseUrl, apiLogin: input.apiLogin }], ['POST', '/connect', input],
    ['POST', '/tables-preview', { displayName: input.displayName, apiBaseUrl: input.apiBaseUrl,
      apiLogin: input.apiLogin, organizationId: input.organizationId }],
    ['POST', '/orders-observation', revision], ['POST', '/orders-diagnostics', revision],
    ['POST', '/bill-diagnostics', { ...revision, orderId: input.organizationId }], ['POST', '/recheck', revision],
    ['POST','/table-loading-preview',revision], ['POST','/table-loading',{...revision,confirmationProof:input.confirmationProof,confirmed:true}],
    ['PATCH', '', { displayName: 'MOLO', ...revision }], ['POST', '/disconnect', revision]];
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
      if (['/tables-preview', '/orders-observation','/orders-diagnostics','/bill-diagnostics','/readiness','/table-loading-preview','/table-loading','/auto-status','/auto-status-preview','/enable-auto-status','/disable-auto-status'].includes(path) && role === 'owner') assert.equal(response.headers.get('cache-control'), 'no-store');
    }
  }
  const before = serviceCalls;
  const invalid = await fetch(`${base}/syrve-integration/tables-preview`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({ displayName: input.displayName, apiBaseUrl: input.apiBaseUrl,
      apiLogin: input.apiLogin, organizationId: 'invalid' }),
  });
  assert.equal(invalid.status, 400);
  assert.equal(serviceCalls, before);
  for (const [path, body] of [
    ['/connect', { ...input, confirmationProof: undefined }],
    ['/connect', { ...input, pairs: [{ moloTableId: 'invalid', syrveTableId: input.organizationId }] }],
    ['/connect', { ...input, pairs: [{ moloTableId: input.organizationId, syrveTableId: input.organizationId, tableNumber: '77' }] }],
    ['/recheck', {}], ['/disconnect', {}], ['/orders-observation', {}],
    ['/orders-observation', { ...revision, tableIds: ['11111111-2222-4333-8444-555555555555'] }],
    ['/orders-observation', { ...revision, orderIds: ['11111111-2222-4333-8444-555555555555'] }],
    ['/orders-diagnostics', {}],
    ['/orders-diagnostics', { ...revision, tableIds: [input.organizationId] }],
    ['/orders-diagnostics', { ...revision, orderIds: [input.organizationId] }],
    ['/orders-diagnostics', { ...revision, apiLogin: 'caller-supplied-secret' }],
    ['/bill-diagnostics', {}], ['/bill-diagnostics', revision],
    ['/bill-diagnostics', { ...revision, orderId: '53389' }],
    ['/bill-diagnostics', { ...revision, orderId: input.organizationId, organizationId: input.organizationId }],
    ['/bill-diagnostics', { ...revision, orderId: input.organizationId, apiLogin: 'caller-supplied-secret' }],
    ['/disable-auto-status',{}],['/disable-auto-status',{...revision,enabled:true}],
    ['/auto-status-preview',{...revision,visibilityVerified:true}],['/enable-auto-status',{...revision,confirmed:true,confirmationProof:input.confirmationProof,tableIds:[input.organizationId]}],
    ['/enable-auto-status',{...revision,confirmed:false,confirmationProof:input.confirmationProof}],
    ['/table-loading-preview',{}], ['/table-loading-preview',{...revision,tableIds:[input.organizationId]}],
    ...[{}, {confirmed:false}, {confirmed:'true'}, {confirmed:true}, {confirmed:true,confirmationProof:'bad'},
      {confirmed:true,confirmationProof:input.confirmationProof,tableIds:[input.organizationId]},
      {confirmed:true,confirmationProof:input.confirmationProof,organizationId:input.organizationId},
      {confirmed:true,confirmationProof:input.confirmationProof,terminalGroupId:input.organizationId},
      {confirmed:true,confirmationProof:input.confirmationProof,complete:true},
    ].map(extra=>['/table-loading',{...revision,...extra}]),
  ]) {
    const response = await fetch(`${base}/syrve-integration${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 400, path);
    assert.equal(serviceCalls, before);
  }
});
