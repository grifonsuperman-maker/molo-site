export type GuestRuntimeBookingAccess = {
  bookingId: string;
  token: string;
};

export type GuestRuntimeAccess = {
  guestDeviceId: string;
  bookings: GuestRuntimeBookingAccess[];
};

const GUEST_BOOKINGS_STORAGE_KEY = 'molo:guest:bookings:v1';
const GUEST_DEVICE_ID_STORAGE_KEY = 'molo:guest:device-id:v1';
const MAX_RUNTIME_BOOKINGS = 100;

let runtimeGuestDeviceId = '';
let runtimeBookings: GuestRuntimeBookingAccess[] = [];

function normalizeBookingAccess(value: unknown): GuestRuntimeBookingAccess | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as { bookingId?: unknown; token?: unknown };
  const bookingId = String(candidate.bookingId || '').trim();
  const token = String(candidate.token || '').trim();
  if (!bookingId || !token) return null;
  return { bookingId, token };
}

export function rememberGuestRuntimeAccess(
  guestDeviceId: string,
  bookings: GuestRuntimeBookingAccess[] = [],
) {
  const normalizedDeviceId = String(guestDeviceId || '').trim();
  if (normalizedDeviceId) runtimeGuestDeviceId = normalizedDeviceId;

  const byBookingId = new Map(
    runtimeBookings.map((booking) => [booking.bookingId, booking]),
  );

  for (const value of bookings) {
    const booking = normalizeBookingAccess(value);
    if (booking) byBookingId.set(booking.bookingId, booking);
  }

  runtimeBookings = [...byBookingId.values()].slice(-MAX_RUNTIME_BOOKINGS);
}

export function getGuestRuntimeAccess(): GuestRuntimeAccess {
  return {
    guestDeviceId: runtimeGuestDeviceId,
    bookings: runtimeBookings.map((booking) => ({ ...booking })),
  };
}

export function readGuestBrowserAccess(): GuestRuntimeAccess {
  const runtime = getGuestRuntimeAccess();
  if (typeof window === 'undefined') return runtime;

  try {
    const storage = window.localStorage;
    const storedDeviceId = String(
      storage.getItem(GUEST_DEVICE_ID_STORAGE_KEY) || '',
    ).trim();
    const parsed = JSON.parse(storage.getItem(GUEST_BOOKINGS_STORAGE_KEY) || '[]');
    const storedBookings = Array.isArray(parsed)
      ? parsed
          .map(normalizeBookingAccess)
          .filter((booking): booking is GuestRuntimeBookingAccess => Boolean(booking))
      : [];

    rememberGuestRuntimeAccess(storedDeviceId, storedBookings);
  } catch {
    // Guest access captured in this tab remains usable when browser storage is blocked.
  }

  return getGuestRuntimeAccess();
}
