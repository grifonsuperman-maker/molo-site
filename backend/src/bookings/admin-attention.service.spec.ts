import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { AdminAttentionService } from './admin-attention.service';
import { BookingTableChangeRequest } from './entities/booking-table-change-request.entity';
import { GuestAdminCall } from './entities/guest-admin-call.entity';

function createService(dataSource: any) {
  return new AdminAttentionService(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    dataSource,
    {} as any,
    {} as any,
    {} as any,
  );
}

test('guest table-change request keeps the current table until Admin approval', async () => {
  const currentTable = { id: 'table-1', tableNumber: '1' };
  const booking = {
    id: 'booking-1',
    status: 'approved',
    checkedInAt: null,
    table: currentTable,
  } as any;
  const savedRequests: any[] = [];

  const requestRepository = {
    async findOne() {
      return null;
    },
    create(value: any) {
      return value;
    },
    async save(value: any) {
      savedRequests.push(value);
      return value;
    },
  };
  const manager = {
    getRepository(entity: unknown) {
      if (entity === BookingTableChangeRequest) return requestRepository;
      throw new Error('Unexpected repository');
    },
  };
  const service = createService({
    async transaction(callback: (value: any) => Promise<unknown>) {
      return callback(manager);
    },
  });

  (service as any).findOwnedBooking = async () => booking;
  (service as any).resolveRequestedTableNumber = async () => '18';
  (service as any).saveHistory = async () => undefined;

  const result = await service.requestTableChange(
    booking.id,
    'guest-token',
    { tableNumber: '18' },
  );

  assert.equal(result.message, 'Запит на зміну столу надіслано Адміністратору');
  assert.equal(savedRequests.length, 1);
  assert.equal(savedRequests[0].booking, booking);
  assert.equal(savedRequests[0].requestedTableNumber, '18');
  assert.equal(savedRequests[0].status, 'pending');
  assert.equal(booking.table, currentTable);
});

test('Admin call must be accepted before it can be completed', async () => {
  const call = {
    id: 'call-1',
    status: 'new',
    createdAt: new Date(),
    acceptedAt: null,
    completedAt: null,
    booking: {
      id: 'booking-1',
      table: { tableNumber: '5' },
      client: { fullName: 'Гість' },
    },
  } as any;

  const callRepository = {
    async findOne() {
      return call;
    },
    async save(value: any) {
      return value;
    },
  };
  const manager = {
    getRepository(entity: unknown) {
      if (entity === GuestAdminCall) return callRepository;
      throw new Error('Unexpected repository');
    },
  };
  const service = createService({
    async transaction(callback: (value: any) => Promise<unknown>) {
      return callback(manager);
    },
  });
  (service as any).saveHistory = async () => undefined;

  const accepted = await service.acceptAdminCall(call.id, {
    role: 'admin',
    staffId: 'admin-1',
    name: 'Адміністратор',
  } as any);
  assert.equal(accepted.call.status, 'accepted');
  assert.ok(call.acceptedAt);

  const completed = await service.completeAdminCall(call.id, {
    role: 'admin',
    staffId: 'admin-1',
    name: 'Адміністратор',
  } as any);
  assert.equal(completed.call.status, 'completed');
  assert.ok(call.completedAt);
});
