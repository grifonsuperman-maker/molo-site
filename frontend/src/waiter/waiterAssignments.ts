import type { Booking } from '../api/types';
import type { WaiterAssignment } from '../api/waiterCalls';

export function waiterAssignmentsFromBookings(
  bookings: Booking[],
): WaiterAssignment[] {
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
