import type { Booking } from '../../api/types';

export type BookingWaiterAssignment = {
  bookingId: string;
  tableId: string | null;
  tableNumber: string | null;
  waiterId: string;
  waiterName: string;
  assignedAt: string;
};

export function waiterAssignmentsFromBookings(
  bookings: Booking[],
): BookingWaiterAssignment[] {
  return bookings.flatMap((booking) => {
    if (!booking.assignedWaiterId) return [];

    return [
      {
        bookingId: booking.id,
        tableId: booking.table?.id || null,
        tableNumber: booking.table?.tableNumber || null,
        waiterId: booking.assignedWaiterId,
        waiterName: booking.assignedWaiterName || 'Офіціант',
        assignedAt:
          booking.checkedInAt || booking.approvedAt || booking.createdAt,
      },
    ];
  });
}
