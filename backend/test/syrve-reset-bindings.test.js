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

function setup({ failBackup = false, workerBusy = false, activationEnabled = false } = {}) {
  const queries = [];
  const entity = { id: ID, configurationRevision: REVISION, organizationId: ID,
    apiBaseUrl: 'https://api-eu.syrve.live', apiLoginEncrypted: 'private-ciphertext', apiLoginIv: 'iv',
    apiLoginAuthTag: 'tag', apiLoginMasked: '***', status: 'connected' };
  const snapshot = { prepared: true, entity, links: [LINK] };
  const stored = { links: [{ id: LINK.id, integration_id: ID, molo_table_id: LINK.moloTableId }],
    sync_states: [{ link_id: LINK.id }], order_versions: [{ link_id: LINK.id }],
    activation: [], worker: [] };
  let savedCopy, savedEntity;
  const manager = {
    query: async (sql, params = []) => {
      queries.push({ sql, params });
      if (sql.startsWith('SELECT lease_until')) return [{ busy: workerBusy }];
      if (sql.startsWith('SELECT enabled')) return [{ enabled: activationEnabled }];
      if (sql.startsWith('SELECT jsonb_build_object(')) return [{ snapshot: stored }];
      if (sql.startsWith('INSERT INTO ') && sql.includes('syrve_binding_reset_backups')) {
        if (failBackup) throw new Error('backup DB unavailable');
        savedCopy = JSON.parse(params[5]);
        return [];
      }
      if (sql.startsWith('DELETE FROM ')) return [{ id: LINK.id }];
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
  return { service, queries, logs, entity, saved: () => savedCopy, next: () => savedEntity };
}

test('clean reconnect snapshots links, durable order ledger and activation before deletion, then clears only API access', async () => {
  const h = setup();
  const response = await h.service.resetBindings(REQUEST, ACTOR);
  const sql = h.queries.map(row => row.sql);
  const backup = sql.findIndex(value => value.startsWith('INSERT INTO ') && value.includes('syrve_binding_reset_backups'));
  const deletion = sql.findIndex(value => value.startsWith('DELETE FROM '));
  assert.ok(backup >= 0 && deletion > backup);
  assert.equal(h.saved().links.length, 1);
  assert.equal(h.saved().sync_states.length, 1);
  assert.equal(h.saved().order_versions.length, 1);
  assert.ok(!JSON.stringify(h.saved()).includes('private-ciphertext'));
  assert.equal(h.next().apiLoginEncrypted, null);
  assert.equal(h.next().organizationId, null);
  assert.equal(response.removedLinks, 1);
  assert.equal(response.integration.confirmedLinks, 0);
  assert.equal(response.integration.hasCredentials, false);
  assert.match(response.backupId, /^[0-9a-f-]{36}$/);
  assert.equal(h.logs.length, 1);
});

test('failure to store the backup never starts deleting live Syrve links', async () => {
  const h = setup({ failBackup: true });
  await assert.rejects(h.service.resetBindings(REQUEST, ACTOR), /backup DB unavailable/);
  assert.ok(!h.queries.some(row => row.sql.startsWith('DELETE FROM ')));
  assert.equal(h.next(), undefined);
});

test('reset rejects a stale link count, active worker lease, enabled auto statuses and non-Director session', async () => {
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
