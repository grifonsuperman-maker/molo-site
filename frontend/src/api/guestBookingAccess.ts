import { bookingsApi } from './bookings';

type StoredGuestBooking = {
  bookingId?: unknown;
  token?: unknown;
};

type PatchableBookingsApi = typeof bookingsApi & {
  __guestBookingTokenCapturePatched?: boolean;
};

const GUEST_BOOKINGS_STORAGE_KEY = 'molo:guest:bookings:v1';
const guestBookingTokens = new Map<string, string>();
const patchableBookingsApi = bookingsApi as PatchableBookingsApi;

function rememberGuestBookingToken(bookingId: string, token: string) {
  if (bookingId && token) guestBookingTokens.set(bookingId, token);
}

function guestBookingToken(bookingId: string): string {
  const inMemoryToken = guestBookingTokens.get(bookingId);
  if (inMemoryToken) return inMemoryToken;
  if (typeof window === 'undefined') return '';

  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(GUEST_BOOKINGS_STORAGE_KEY) || '[]',
    );
    if (!Array.isArray(parsed)) return '';

    const booking = parsed.find(
      (item: StoredGuestBooking) => item?.bookingId === bookingId,
    );
    const token = typeof booking?.token === 'string' ? booking.token : '';
    if (token) rememberGuestBookingToken(bookingId, token);
    return token;
  } catch {
    return '';
  }
}

export function guestBookingHeaders(bookingId: string): HeadersInit {
  return { 'x-guest-booking-token': guestBookingToken(bookingId) };
}

if (!patchableBookingsApi.__guestBookingTokenCapturePatched) {
  const originalCreate = bookingsApi.create.bind(bookingsApi);

  bookingsApi.create = async (payload) => {
    const result = await originalCreate(payload);
    rememberGuestBookingToken(result.bookingId, result.guestAccessToken);
    return result;
  };

  patchableBookingsApi.__guestBookingTokenCapturePatched = true;
}
