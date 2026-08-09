type WaiterCallBooking = {
  status: string;
  bookingDate: string;
};

export function isWaiterCallBookingForToday(
  booking: WaiterCallBooking,
  today: string,
) {
  return booking.status === 'approved' && booking.bookingDate === today;
}
