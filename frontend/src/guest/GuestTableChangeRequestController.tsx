import { useEffect } from 'react';

import { bookingsApi, type GuestBooking } from '../api/bookings';
import { api } from '../api/client';

type GuestActionResponse = {
  message: string;
  booking?: GuestBooking;
  askExternalReview?: boolean;
};

export default function GuestTableChangeRequestController() {
  useEffect(() => {
    const original = bookingsApi.guestChangeTable;

    bookingsApi.guestChangeTable = (
      id: string,
      token: string,
      table: { tableId?: string; tableNumber?: string },
    ) =>
      api.patch<GuestActionResponse>(
        `/bookings/${encodeURIComponent(id)}/guest/table-change-request`,
        { tableNumber: table.tableNumber },
        { headers: { 'x-guest-booking-token': token } },
      );

    return () => {
      bookingsApi.guestChangeTable = original;
    };
  }, []);

  return null;
}
