import { api } from './client';

function guestHeaders(token: string): HeadersInit {
  return { 'x-guest-booking-token': token };
}

export const guestRequestsApi = {
  callAdmin: (bookingId: string, token: string) =>
    api.post<{ message: string }>(
      `/bookings/${encodeURIComponent(bookingId)}/guest/call-admin`,
      undefined,
      { headers: guestHeaders(token) },
    ),
};
