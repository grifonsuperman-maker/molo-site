const assert = require('node:assert/strict');
const test = require('node:test');

const { AdminPermissionsService } = require('../dist/restaurant/admin-permissions.service.js');

test('owner always has granular Director permissions', async () => {
  const service = new AdminPermissionsService({ findOne: async () => null });
  await service.assert({ role: 'owner' }, 'adminCanSendBroadcasts');
});

test('admin is blocked when Director did not grant permission', async () => {
  const service = new AdminPermissionsService({
    findOne: async () => ({ adminCanSendBroadcasts: false }),
  });

  await assert.rejects(
    () => service.assert({ role: 'admin' }, 'adminCanSendBroadcasts'),
    /Директор не надав це право/,
  );
});

test('admin is allowed when Director granted permission', async () => {
  const service = new AdminPermissionsService({
    findOne: async () => ({ adminCanManageBlacklist: true }),
  });

  await service.assert({ role: 'admin' }, 'adminCanManageBlacklist');
});
