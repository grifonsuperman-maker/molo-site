import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { AdminAttentionService } from './admin-attention.service';
import { BookingTableChangeRequest } from './entities/booking-table-change-request.entity';

function createService(dataSource: any) {
  return new AdminAttentionService(
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
