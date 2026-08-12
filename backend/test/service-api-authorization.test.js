require('reflect-metadata');

const assert = require('node:assert/strict');
const test = require('node:test');

const { BookingsController } = require('../dist/bookings/bookings.controller.js');
const { TablesController } = require('../dist/tables/tables.controller.js');
const { ZonesController } = require('../dist/zones/zones.controller.js');

function metadata(controller, method) {
  const handler = controller.prototype[method];
  return {
    isPublic: Reflect.getMetadata('isPublic', handler) === true,
    roles: Reflect.getMetadata('roles', handler) || [],
  };
}

function expectPublic(controller, method) {
  assert.deepEqual(metadata(controller, method), { isPublic: true, roles: [] });
}

function expectProtected(controller, method, roles) {
  assert.deepEqual(metadata(controller, method), { isPublic: false, roles });
}

test('guest booking routes stay public', () => {
  for (const method of [
    'create',
    'availability',
    'tableStatuses',
    'guestList',
    'guestBooking',
    'guestCancel',
    'guestLateness',
    'guestChangeTable',
    'guestAcknowledgeNotification',
    'guestReview',
    'guestExternalReviewOpened',
    'publicStatus',
  ]) {
    expectPublic(BookingsController, method);
  }
});

test('staff booking lists and actions require intended roles', () => {
  expectProtected(BookingsController, 'pendingRemindersList', ['admin', 'owner']);
  expectProtected(BookingsController, 'today', ['waiter', 'admin', 'owner']);
  expectProtected(BookingsController, 'byDate', ['admin', 'owner']);
  expectProtected(BookingsController, 'archive', ['admin', 'owner']);
  expectProtected(BookingsController, 'stats', ['admin', 'owner']);

  for (const method of ['approve', 'reject', 'cancel', 'noShow']) {
    expectProtected(BookingsController, method, ['admin', 'owner']);
  }

  for (const method of ['checkIn', 'complete']) {
    expectProtected(BookingsController, method, ['waiter', 'admin', 'owner']);
  }

  expectProtected(BookingsController, 'waiterTransfer', ['admin', 'owner']);
});

test('table reads stay public while mutations require staff roles', () => {
  expectPublic(TablesController, 'findAll');

  expectProtected(TablesController, 'create', ['owner']);
  expectProtected(TablesController, 'update', ['owner']);
  expectProtected(TablesController, 'remove', ['owner']);
  expectProtected(TablesController, 'statusByNumber', ['admin', 'owner']);
  expectProtected(TablesController, 'status', ['admin', 'owner']);
  expectProtected(TablesController, 'open', ['admin', 'owner']);
  expectProtected(TablesController, 'close', ['admin', 'owner']);

  for (const method of ['waiterStatus', 'occupied', 'cleaning', 'free']) {
    expectProtected(TablesController, method, ['waiter', 'admin', 'owner']);
  }
});

test('zone reads stay public while Director and permitted Admin routes are protected', () => {
  expectPublic(ZonesController, 'findAll');

  for (const method of ['create', 'update', 'close', 'open', 'remove']) {
    expectProtected(ZonesController, method, ['owner']);
  }

  for (const method of ['adminClose', 'adminOpen']) {
    expectProtected(ZonesController, method, ['admin', 'owner']);
  }
});
