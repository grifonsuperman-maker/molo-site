import { api } from './client';

export const guestTelegramLinkApi = {
  link: (bookingId: string, guestToken: string) =>
    api.patch<{ message: string; linked: boolean }>(
      `/bookings/${encodeURIComponent(bookingId)}/guest/telegram`,
      undefined,
      { headers: { 'x-guest-booking-token': guestToken } },
    ),
};
