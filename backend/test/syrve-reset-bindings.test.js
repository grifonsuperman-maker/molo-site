const assert = require('node:assert/strict');
const test = require('node:test');
const { SyrveIntegrationService } = require('../dist/syrve/syrve-integration.service.js');

const ID = '11111111-2222-4333-8444-555555555555';
const REVISION = '22222222-3333-4444-8555-666666666666';
const LINK = { id: '33333333-4444-4555-8666-777777777777', integrationId: ID,
  organizationId: ID, moloTableId: '44444444-5555-4666-8777-888888888888',
  syrveTableId: '55555555-6666-4777-8888-999999999999', lastKnownNumber: 8 };
const ACTOR = { sub: 'director', directorSessionVersion: 1, role: 'owner' };
const REQUEST = { configurationRevision: REVISION, expectedLinks: 1, confirmed: true, confirmationText: 'СКИНУТИ' };

function setup({ failDelete = false, workerBusy = false, activationEnabled = false,
  activationRevision = REVISION } = {}) {
  const queries = [];
  const entity = { id: ID, configurationRevision: REVISION, organizationId: ID,
    apiBaseUrl: 'https://api-eu.syrve.live', apiLoginEncrypted: 'private-ciphertext', apiLoginIv: 'iv',
    apiLoginAuthTag: 'tag', apiLoginMasked: '***', status: 'connected' };
  const snapshot = { prepared: true, entity, links: [LINK] };
  let savedEntity;
  const manager = {
    query: async (sql, params = []) => {
      queries.push({ sql, params });
      if (sql.startsWith('SELECT lease_until')) return [{ busy: workerBusy }];
      if (sql.startsWith('SELECT enabled')) return [{ enabled: activationEnabled, configuration_revision: activationRevision }];
      if (sql.startsWith('DELETE FROM ')) {
        if (failDelete) throw new Error('database delete failed');
        return [{ id: LINK.id }];
      }
      return [];
    },
  };
  const settings = {
    read: async () => snapshot,
    table: name => '"public"."' + name + '"',
    transaction: async (version, action) => {
      assert.equal(version.revision, REVISION);
      return action(manager, snapshot);
    },
    save: async (_manager, data) => {
      savedEntity = { ...data, configurationRevision: '66666666-7777-4888-8999-aaaaaaaaaaaa' };
      return savedEntity;
    },
  };
  const logs = [];
  const service = new SyrveIntegrationService(settings,
    { create: async (...args) => logs.push(args) }, {},
    {}, { requireDisabled: async () => {} });
  return { service, queries, logs, next: () => savedEntity };
}

test('clean reconnect deletes only Syrve links and clears credentials in one settings transaction', async () => {
  const h = setup();
  const response = await h.service.resetBindings(REQUEST, ACTOR);
  const sql = h.queries.map(row => row.sql);
  assert.equal(sql.filter(value => value.startsWith('DELETE FROM ')).length, 1);
  assert.match(sql.find(value => value.startsWith('DELETE FROM ')), /syrve_table_links/);
  assert.ok(!sql.some(value => /DELETE FROM .*tables(?!_)/.test(value)));
  assert.ok(!sql.some(value => /syrve_binding_reset_backups/.test(value)));
  assert.ok(sql.some(value => /UPDATE .*syrve_sync_activation/.test(value)));
  assert.equal(h.next().apiLoginEncrypted, null);
  assert.equal(h.next().organizationId, null);
  assert.equal(h.next().status, 'not_connected');
  assert.equal(response.removedLinks, 1);
  assert.equal(response.integration.confirmedLinks, 0);
  assert.equal(response.integration.hasCredentials, false);
  assert.equal(h.logs.length, 1);
});

test('reset accepts stale enabled activation row after disconnect revision rotation', async () => {
  const staleRevision = '77777777-8888-4999-8aaa-bbbbbbbbbbbb';
  const h = setup({ activationEnabled: true, activationRevision: staleRevision });
  const response = await h.service.resetBindings(REQUEST, ACTOR);
  assert.equal(response.removedLinks, 1);
  assert.equal(response.integration.confirmedLinks, 0);
  assert.ok(h.queries.some(row => row.sql.includes('SELECT enabled, configuration_revision')));
});

test('failed link deletion does not clear saved API credentials', async () => {
  const h = setup({ failDelete: true });
  await assert.rejects(h.service.resetBindings(REQUEST, ACTOR), /database delete failed/);
  assert.equal(h.next(), undefined);
});

test('reset rejects stale count, active worker lease, enabled auto statuses, and non-Director session', async () => {
  for (const [config, input, actor] of [
    [{}, { ...REQUEST, expectedLinks: 36 }, ACTOR],
    [{ workerBusy: true }, REQUEST, ACTOR],
    [{ activationEnabled: true }, REQUEST, ACTOR],
    [{}, REQUEST, { role: 'waiter', sub: 'staff', directorSessionVersion: 1 }],
    [{}, REQUEST, { role: 'owner', sub: 'test', directorSessionVersion: undefined }],
  ]) {
    const h = setup(config);
    await assert.rejects(h.service.resetBindings(input, actor));
    assert.ok(!h.queries.some(row => row.sql.startsWith('DELETE FROM ')));
  }
});
