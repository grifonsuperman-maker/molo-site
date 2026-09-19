import type { Booking } from '../../api/types';

export type BookingWaiterAssignment = {
  bookingId: string;
  tableId: string | null;
  tableNumber: string | null;
  waiterId: string;
  waiterName: string;
  assignedAt: string;
};

type OwnedBookingTable = NonNullable<Booking['table']> & { assignedWaiterId?: string | null };

export function waiterAssignmentsFromBookings(
  bookings: Booking[],
): BookingWaiterAssignment[] {
  return bookings.flatMap((booking) => {
    const tableOwner = (booking.table as OwnedBookingTable | null)?.assignedWaiterId;
    const waiterId = tableOwner || booking.assignedWaiterId;
    if (!waiterId) return [];

    return [
      {
        bookingId: booking.id,
        tableId: booking.table?.id || null,
        tableNumber: booking.table?.tableNumber || null,
        waiterId,
        waiterName: booking.assignedWaiterName || 'Офіціант',
        assignedAt:
          booking.checkedInAt || booking.approvedAt || booking.createdAt,
      },
    ];
  });
}
