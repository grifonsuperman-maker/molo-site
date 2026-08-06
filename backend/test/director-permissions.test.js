const assert = require('node:assert/strict');
const test = require('node:test');

const { AdminPermissionsService } = require('../dist/restaurant/admin-permissions.service.js');

test('owner always has granular Director permissions', async () => {
  const service = new AdminPermissionsService({ find: async () => [] });
  await service.assert({ role: 'owner' }, 'adminCanSendBroadcasts');
});

test('admin is blocked when Director did not grant permission', async () => {
  const service = new AdminPermissionsService({
    find: async (options) => {
      assert.deepEqual(options, { order: { createdAt: 'ASC' }, take: 1 });
      return [{ adminCanSendBroadcasts: false }];
    },
  });

  await assert.rejects(
    () => service.assert({ role: 'admin' }, 'adminCanSendBroadcasts'),
    /Директор не надав це право/,
  );
});

test('admin is allowed when Director granted permission', async () => {
  const service = new AdminPermissionsService({
    find: async (options) => {
      assert.deepEqual(options, { order: { createdAt: 'ASC' }, take: 1 });
      return [{ adminCanManageBlacklist: true }];
    },
  });

  await service.assert({ role: 'admin' }, 'adminCanManageBlacklist');
});
