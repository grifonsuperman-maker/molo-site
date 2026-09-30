import type { Booking } from './entities/booking.entity';

type AssignedBooking = Booking & { assignedWaiterId?: string | null };

const ACTIVE_BOOKING_STATUSES = new Set(['pending', 'approved']);

/**
 * Manual bookings stay shared before waiter ownership is known.
 * Once an active manual visit belongs to a waiter, only that waiter sees it.
 * Closed bookings are never filtered so waiter history remains intact.
 */
export function waiterCanSeeBooking(
  booking: AssignedBooking,
  waiterId: string | null | undefined,
): boolean {
  if (!ACTIVE_BOOKING_STATUSES.has(booking.status)) return true;
  if (booking.source !== 'admin_manual' || !booking.checkedInAt || !booking.assignedWaiterId) {
    return true;
  }
  return booking.assignedWaiterId === waiterId;
}
