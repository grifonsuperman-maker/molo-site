import { api } from '../api/client';
import { bookingsApi } from '../api/bookings';

bookingsApi.guestChangeTable = (
  id: string,
  token: string,
  table: { tableId?: string; tableNumber?: string },
) =>
  api.patch<{ message: string }>(
    `/bookings/${encodeURIComponent(id)}/guest/request-table-change`,
    table,
    { headers: { 'x-guest-booking-token': token } },
  );

export default function GuestTableChangeRequestBridge() {
  return null;
}
