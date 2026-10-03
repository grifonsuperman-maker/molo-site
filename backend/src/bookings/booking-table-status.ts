import { EntityManager, In } from 'typeorm';

import { TableEntity } from '../tables/entities/table.entity';
import { bookingTableAssignmentsReady } from './booking-table-assignment-transfer';
import { Booking, BookingStatus } from './entities/booking.entity';

const ACTIVE_BOOKING_STATUSES: BookingStatus[] = ['pending', 'approved'];

export async function remainingBookingStatusForTable(
  manager: EntityManager,
  tableId: string,
  bookingDate: string,
  knownAssignmentsReady?: boolean,
): Promise<TableEntity['status']> {
  const bookings = manager.getRepository(Booking);
  const assignmentsReady =
    knownAssignmentsReady ?? await bookingTableAssignmentsReady(manager);

  const activeBookings = assignmentsReady
    ? await bookings
      .createQueryBuilder('activeBooking')
      .leftJoin('activeBooking.table', 'activeTable')
      .leftJoin('activeBooking.tableAssignments', 'activeAssignment')
      .leftJoin('activeAssignment.table', 'activeAssignedTable')
      .where(
        '(activeTable.id = :tableId OR activeAssignedTable.id = :tableId)',
        { tableId },
      )
      .andWhere('activeBooking.bookingDate = :bookingDate', { bookingDate })
      .andWhere('activeBooking.status IN (:...statuses)', {
        statuses: ACTIVE_BOOKING_STATUSES,
      })
      .distinct(true)
      .getMany()
    : await bookings.find({
      where: {
        table: { id: tableId },
        bookingDate,
        status: In(ACTIVE_BOOKING_STATUSES),
      } as any,
    });

  if (activeBookings.some((booking) => booking.status === 'approved')) {
    return 'reserved';
  }
  if (activeBookings.some((booking) => booking.status === 'pending')) {
    return 'pending';
  }
  return 'free';
}

export async function synchronizeBookingTableStatusForDate(
  manager: EntityManager,
  tableId: string,
  bookingDate: string,
  options: {
    assignmentsReady?: boolean;
    allowPhysicalRelease?: boolean;
  } = {},
) {
  const tables = manager.getRepository(TableEntity);
  const table = await tables.findOne({
    where: { id: tableId },
    lock: { mode: 'pessimistic_write' },
  });
  if (!table || table.status === 'closed') return table?.status || null;

  if (
    !options.allowPhysicalRelease &&
    (table.status === 'occupied' || table.status === 'cleaning')
  ) {
    return table.status;
  }

  const nextStatus = await remainingBookingStatusForTable(
    manager,
    tableId,
    bookingDate,
    options.assignmentsReady,
  );

  if (table.status !== nextStatus) {
    table.status = nextStatus;
    await tables.save(table);
  }
  return table.status;
}
