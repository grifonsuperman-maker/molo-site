type GuestServiceBooking = {
  status: string;
  bookingDate: string;
};

export function isGuestServiceBookingForToday(
  booking: GuestServiceBooking,
  today: string,
) {
  return booking.status === 'approved' && booking.bookingDate === today;
}

export function shouldRefreshGuestServiceStatusOnVisibility(
  visibilityState: string,
) {
  return visibilityState === 'visible';
}

export function isGuestServiceStatusSnapshotCurrent(
  requestId: number,
  latestRequestId: number,
  mutationVersion: number,
  currentMutationVersion: number,
) {
  return (
    requestId === latestRequestId &&
    mutationVersion === currentMutationVersion
  );
}

export const isWaiterCallBookingForToday = isGuestServiceBookingForToday;
