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
const runtimeOnlyBookingIds = new Set<string>();

function normalizeBookingAccess(value: unknown): GuestRuntimeBookingAccess | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as { bookingId?: unknown; token?: unknown };
  if (
    typeof candidate.bookingId !== 'string' ||
    typeof candidate.token !== 'string'
  ) {
    return null;
  }

  const bookingId = candidate.bookingId.trim();
  const token = candidate.token.trim();
  if (!bookingId || !token) return null;
  return { bookingId, token };
}

function capRuntimeBookings(bookings: GuestRuntimeBookingAccess[]) {
  runtimeBookings = bookings.slice(0, MAX_RUNTIME_BOOKINGS);
  const retainedBookingIds = new Set(
    runtimeBookings.map((booking) => booking.bookingId),
  );

  for (const bookingId of runtimeOnlyBookingIds) {
    if (!retainedBookingIds.has(bookingId)) {
      runtimeOnlyBookingIds.delete(bookingId);
    }
  }
}

export function rememberGuestRuntimeAccess(
  guestDeviceId: string,
  bookings: GuestRuntimeBookingAccess[] = [],
) {
  const normalizedDeviceId = String(guestDeviceId || '').trim();
  if (normalizedDeviceId) runtimeGuestDeviceId = normalizedDeviceId;

  const incomingBookings: GuestRuntimeBookingAccess[] = [];
  const incomingBookingIds = new Set<string>();

  for (const value of bookings) {
    const booking = normalizeBookingAccess(value);
    if (!booking || incomingBookingIds.has(booking.bookingId)) continue;
    incomingBookingIds.add(booking.bookingId);
    runtimeOnlyBookingIds.add(booking.bookingId);
    incomingBookings.push(booking);
  }

  capRuntimeBookings([
    ...incomingBookings,
    ...runtimeBookings.filter(
      (booking) => !incomingBookingIds.has(booking.bookingId),
    ),
  ]);
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

    if (storedDeviceId) runtimeGuestDeviceId = storedDeviceId;

    let storedBookings: GuestRuntimeBookingAccess[] = [];
    try {
      const parsed = JSON.parse(storage.getItem(GUEST_BOOKINGS_STORAGE_KEY) || '[]');
      storedBookings = Array.isArray(parsed)
        ? parsed
            .map(normalizeBookingAccess)
            .filter((booking): booking is GuestRuntimeBookingAccess => Boolean(booking))
        : [];
    } catch {
      storedBookings = [];
    }

    const storedBookingIds = new Set(
      storedBookings.map((booking) => booking.bookingId),
    );

    for (const bookingId of storedBookingIds) {
      runtimeOnlyBookingIds.delete(bookingId);
    }

    const runtimeOnlyBookings = runtime.bookings.filter(
      (booking) =>
        runtimeOnlyBookingIds.has(booking.bookingId) &&
        !storedBookingIds.has(booking.bookingId),
    );
    const runtimeOnlyIds = new Set(
      runtimeOnlyBookings.map((booking) => booking.bookingId),
    );

    capRuntimeBookings([
      ...runtimeOnlyBookings,
      ...storedBookings.filter(
        (booking) => !runtimeOnlyIds.has(booking.bookingId),
      ),
    ]);
  } catch {
    // Guest access captured in this tab remains usable when browser storage is blocked.
  }

  return getGuestRuntimeAccess();
}
