import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { WaiterCallsService } from './waiter-calls.service';

function createService() {
  const histories = {
    createQueryBuilder: () => ({
      leftJoin() { return this; },
      where() { return this; },
      andWhere() { return this; },
      orderBy() { return this; },
      async getOne() { return null; },
    }),
  };

  return new WaiterCallsService({} as any, histories as any);
}

test('closeActiveCallsAndDetachBooking hides transferred booking calls and assignments', async () => {
  const service = createService();
  const booking = {
    id: 'transferred-booking',
    status: 'approved',
    table: { id: 'new-table', tableNumber: '2', status: 'reserved' },
  } as any;

  (service as any).calls = [
    {
      id: 'new-call', bookingId: booking.id, tableId: 'old-table', tableNumber: '1',
      clientName: null, waiterId: null, waiterName: null, status: 'new',
      createdAt: '2026-07-21T12:00:00.000Z', acceptedAt: null, closedAt: null,
    },
    {
      id: 'accepted-call', bookingId: booking.id, tableId: 'old-table', tableNumber: '1',
      clientName: null, waiterId: 'waiter-1', waiterName: 'Офіціант', status: 'accepted',
      createdAt: '2026-07-21T12:01:00.000Z', acceptedAt: '2026-07-21T12:01:30.000Z', closedAt: null,
    },
  ];
  (service as any).assignments = [
    {
      bookingId: booking.id, tableId: 'old-table', tableNumber: '1',
      waiterId: 'waiter-1', waiterName: 'Офіціант', assignedAt: '2026-07-21T12:01:30.000Z',
    },
  ];
  (service as any).getBooking = async () => booking;

  service.closeActiveCallsAndDetachBooking(booking.id);

  assert.deepEqual((service as any).calls.map((call: any) => call.status), ['closed', 'closed']);
  assert.equal((service as any).calls.every((call: any) => call.closedAt), true);
  assert.deepEqual(service.list('waiter-1'), []);
  assert.deepEqual(service.myAssignments('waiter-1'), []);
  assert.equal((await service.guestStatus(booking.id)).activeCall, null);
});

test('accept rejects a waiter when a new call is already assigned to another waiter', () => {
  const service = createService();
  (service as any).calls = [
    {
      id: 'assigned-new-call', bookingId: 'booking-1', tableId: 'table-1', tableNumber: '1',
      clientName: null, waiterId: 'waiter-1', waiterName: 'Офіціант 1', status: 'new',
      createdAt: '2026-07-21T12:00:00.000Z', acceptedAt: null, closedAt: null,
    },
  ];

  assert.throws(
    () => service.accept('assigned-new-call', { waiterId: 'waiter-2', waiterName: 'Офіціант 2' }),
    (error: unknown) => {
      assert.equal((error as { getStatus: () => number }).getStatus(), 403);
      return true;
    },
  );
  assert.equal((service as any).calls[0].status, 'new');
  assert.equal((service as any).calls[0].waiterId, 'waiter-1');
});

test('accept allows the waiter already assigned to a new call', () => {
  const service = createService();
  (service as any).calls = [
    {
      id: 'assigned-new-call', bookingId: 'booking-1', tableId: 'table-1', tableNumber: '1',
      clientName: null, waiterId: 'waiter-1', waiterName: 'Офіціант 1', status: 'new',
      createdAt: '2026-07-21T12:00:00.000Z', acceptedAt: null, closedAt: null,
    },
  ];

  const result = service.accept('assigned-new-call', {
    waiterId: 'waiter-1',
    waiterName: 'Офіціант 1',
  });

  assert.equal(result.call.status, 'accepted');
  assert.equal(result.call.waiterId, 'waiter-1');
  assert.ok(result.call.acceptedAt);
});

test('close rejects a waiter who is not assigned to the call', () => {
  const service = createService();
  (service as any).calls = [
    {
      id: 'accepted-call', bookingId: 'booking-1', tableId: 'table-1', tableNumber: '1',
      clientName: null, waiterId: 'waiter-1', waiterName: 'Офіціант 1', status: 'accepted',
      createdAt: '2026-07-21T12:00:00.000Z', acceptedAt: '2026-07-21T12:01:00.000Z', closedAt: null,
    },
  ];

  assert.throws(
    () => service.close('accepted-call', 'waiter-2'),
    (error: unknown) => {
      assert.equal((error as { getStatus: () => number }).getStatus(), 403);
      return true;
    },
  );
  assert.equal((service as any).calls[0].status, 'accepted');
});

test('close allows the assigned waiter to close an accepted call', () => {
  const service = createService();
  (service as any).calls = [
    {
      id: 'accepted-call', bookingId: 'booking-1', tableId: 'table-1', tableNumber: '1',
      clientName: null, waiterId: 'waiter-1', waiterName: 'Офіціант 1', status: 'accepted',
      createdAt: '2026-07-21T12:00:00.000Z', acceptedAt: '2026-07-21T12:01:00.000Z', closedAt: null,
    },
  ];

  const result = service.close('accepted-call', 'waiter-1');

  assert.equal(result.call.status, 'closed');
  assert.ok(result.call.closedAt);
});

test('close rejects a new call until it has been accepted', () => {
  const service = createService();
  (service as any).calls = [
    {
      id: 'new-call', bookingId: 'booking-1', tableId: 'table-1', tableNumber: '1',
      clientName: null, waiterId: null, waiterName: null, status: 'new',
      createdAt: '2026-07-21T12:00:00.000Z', acceptedAt: null, closedAt: null,
    },
  ];

  assert.throws(
    () => service.close('new-call', 'waiter-1'),
    /Спочатку прийміть виклик/,
  );
  assert.equal((service as any).calls[0].status, 'new');
});
