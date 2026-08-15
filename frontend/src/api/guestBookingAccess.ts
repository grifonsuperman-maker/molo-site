import { bookingsApi } from './bookings';
import { guestTelegramLinkApi } from './guestTelegramLink';

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
let telegramLinkQueue: Promise<void> = Promise.resolve();

function rememberGuestBookingToken(bookingId: string, token: string) {
  if (bookingId && token) guestBookingTokens.set(bookingId, token);
}

function storedGuestBookings(): StoredGuestBooking[] {
  if (typeof window === 'undefined') return [];

  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(GUEST_BOOKINGS_STORAGE_KEY) || '[]',
    );
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function guestBookingToken(bookingId: string): string {
  const inMemoryToken = guestBookingTokens.get(bookingId);
  if (inMemoryToken) return inMemoryToken;

  const booking = storedGuestBookings().find(
    (item: StoredGuestBooking) => item?.bookingId === bookingId,
  );
  const token = typeof booking?.token === 'string' ? booking.token : '';
  if (token) rememberGuestBookingToken(bookingId, token);
  return token;
}

function linkGuestBookingToTelegram(bookingId: string, token: string) {
  if (!bookingId || !token) return Promise.resolve();

  telegramLinkQueue = telegramLinkQueue.then(async () => {
    try {
      await guestTelegramLinkApi.link(bookingId, token);
    } catch {
      // Звичайний сайт і бронювання без Telegram мають працювати як раніше.
    }
  });

  return telegramLinkQueue;
}

export async function linkKnownGuestBookingsToTelegram() {
  const known = new Map(guestBookingTokens);

  storedGuestBookings().forEach((booking) => {
    const bookingId = typeof booking?.bookingId === 'string' ? booking.bookingId : '';
    const token = typeof booking?.token === 'string' ? booking.token : '';
    if (bookingId && token && !known.has(bookingId)) known.set(bookingId, token);
  });

  for (const [bookingId, token] of known.entries()) {
    await linkGuestBookingToTelegram(bookingId, token);
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
    void linkGuestBookingToTelegram(result.bookingId, result.guestAccessToken);
    return result;
  };

  patchableBookingsApi.__guestBookingTokenCapturePatched = true;
}
