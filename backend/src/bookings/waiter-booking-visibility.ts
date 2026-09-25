import type { Booking } from './entities/booking.entity';

type AssignedBooking = Booking & { assignedWaiterId?: string | null };

/** Before arrival a manual booking is shared; after arrival only its accepting waiter sees it. */
export function waiterCanSeeBooking(booking: AssignedBooking, waiterId: string | null | undefined): boolean {
  if (booking.source !== 'admin_manual' || !booking.checkedInAt || !booking.assignedWaiterId) {
    return true;
  }
  return booking.assignedWaiterId === waiterId;
}
