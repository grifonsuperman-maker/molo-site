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

export const isWaiterCallBookingForToday = isGuestServiceBookingForToday;
