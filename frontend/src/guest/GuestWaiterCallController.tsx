import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import { bookingsApi, type GuestBooking, type GuestBookingToken } from '../api/bookings';
import { guestRequestsApi } from '../api/guestRequests';
import {
  waiterCallsApi,
  type GuestWaiterCallStatus,
} from '../api/waiterCalls';

const POLLING_INTERVAL_MS = 15_000;
const GUEST_BOOKINGS_STORAGE_KEY = 'molo:guest:bookings:v1';

type GuestBookingListener = (bookings: GuestBooking[]) => void;

let latestGuestBookings: GuestBooking[] = [];
const guestBookingListeners = new Set<GuestBookingListener>();
const originalGuestList = bookingsApi.guestList;

function publishGuestBookings(bookings: GuestBooking[]) {
  latestGuestBookings = bookings;
  guestBookingListeners.forEach((listener) => listener(bookings));
}

// GuestApp already owns the session device id, including its in-memory fallback
// when localStorage is blocked. Observe that exact request instead of reading
// browser storage a second time.
bookingsApi.guestList = async (guestDeviceId: string, tokens: string[] = []) => {
  const bookings = await originalGuestList(guestDeviceId, tokens);
  publishGuestBookings(bookings);
  return bookings;
};

function subscribeGuestBookings(listener: GuestBookingListener) {
  guestBookingListeners.add(listener);
  listener(latestGuestBookings);

  return () => {
    guestBookingListeners.delete(listener);
  };
}

function kyivDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv',
  }).format(new Date());
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : 'Сталася невідома помилка';
}

function readGuestToken(bookingId: string) {
  try {
    const parsed = JSON.parse(localStorage.getItem(GUEST_BOOKINGS_STORAGE_KEY) || '[]');
    if (!Array.isArray(parsed)) return null;
    const access = (parsed as GuestBookingToken[]).find((item) => item.bookingId === bookingId);
    return access?.token || null;
  } catch {
    return null;
  }
}

function WaiterCallCard({ booking }: { booking: GuestBooking }) {
  const [status, setStatus] = useState<GuestWaiterCallStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [calling, setCalling] = useState(false);
  const [adminCalling, setAdminCalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const loadStatus = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const result = await waiterCallsApi.guestStatus(booking.bookingId);
      setStatus(result);
      setError(null);
    } catch (loadError) {
      // A short network problem must not remove the last successful state.
      setError(errorText(loadError));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [booking.bookingId]);

  useEffect(() => {
    void loadStatus();
    const interval = window.setInterval(() => {
      void loadStatus(true);
    }, POLLING_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [loadStatus]);

  async function callWaiter() {
    try {
      setCalling(true);
      setError(null);
      setMessage(null);

      const result = await waiterCallsApi.createFromGuest(booking.bookingId);
      setStatus((current) => ({
        bookingId: booking.bookingId,
        tableNumber:
          result.call.tableNumber || current?.tableNumber || booking.tableNumber,
        bookingStatus: current?.bookingStatus || booking.status,
        tableStatus: current?.tableStatus || 'occupied',
        canCall: true,
        waiterAssigned: Boolean(
          result.call.waiterId || current?.waiterAssigned,
        ),
        waiterName:
          result.call.waiterName || current?.waiterName || null,
        activeCall: result.call,
      }));
      setMessage(result.message || 'Виклик офіціанта відправлено');
    } catch (callError) {
      setError(errorText(callError));
    } finally {
      setCalling(false);
    }
  }

  async function callAdmin() {
    const token = readGuestToken(booking.bookingId);
    if (!token) {
      setError('Не вдалося підтвердити доступ до бронювання');
      return;
    }
    try {
      setAdminCalling(true);
      setError(null);
      setMessage(null);
      const result = await guestRequestsApi.callAdmin(booking.bookingId, token);
      setMessage(result.message || 'Адміністратора викликано');
    } catch (callError) {
      setError(errorText(callError));
    } finally {
      setAdminCalling(false);
    }
  }

  const activeCall = status?.activeCall || null;
  const tableNumber = status?.tableNumber || booking.tableNumber || '—';

  return (
    <section className="rounded-[24px] border border-amber-200/30 bg-black/35 p-4 text-left backdrop-blur">
      <p className="text-sm font-black text-white">Потрібна допомога?</p>
      <p className="mt-1 text-xs leading-5 text-white/55">
        {booking.bookingDate} · {String(booking.bookingTime).slice(0, 5)} · Стіл №{tableNumber}
      </p>

      {loading && !status && (
        <p className="mt-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-xs text-white/55">
          Перевіряємо доступність виклику офіціанта…
        </p>
      )}

      {error && (
        <p className="mt-3 rounded-2xl border border-red-300/30 bg-red-400/10 px-4 py-3 text-xs text-red-100">
          {error}
        </p>
      )}

      {message && (
        <p className="mt-3 rounded-2xl border border-emerald-300/30 bg-emerald-400/10 px-4 py-3 text-xs font-semibold text-emerald-100">
          {message}
        </p>
      )}

      {activeCall && (
        <div className="mt-3 rounded-2xl border border-amber-200/30 bg-amber-300/10 px-4 py-3 text-amber-100">
          <p className="text-sm font-black">
            {activeCall.status === 'accepted'
              ? 'Офіціант прийняв виклик'
              : 'Виклик офіціанта відправлено'}
          </p>
          <p className="mt-1 text-xs text-amber-100/70">
            {activeCall.waiterName
              ? `Офіціант: ${activeCall.waiterName}`
              : 'Виклик у загальному списку офіціантів'}
          </p>
        </div>
      )}

      {!loading && status && !activeCall && status.canCall && (
        <button
          type="button"
          onClick={callWaiter}
          disabled={calling}
          className="mt-3 w-full rounded-2xl border border-amber-200/60 bg-amber-300/20 px-4 py-3 text-sm font-black text-amber-100 transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {calling ? 'Викликаємо…' : '🔔 Викликати офіціанта'}
        </button>
      )}

      {!loading && status && !activeCall && !status.canCall && (
        <p className="mt-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-xs leading-5 text-white/50">
          Виклик стане доступним після того, як Адміністратор або Офіціант відмітить «Гість прийшов».
        </p>
      )}

      {Boolean(booking.checkedInAt) && (
        <button
          type="button"
          onClick={callAdmin}
          disabled={adminCalling}
          className="mt-3 w-full rounded-2xl border border-fuchsia-300/60 bg-black/45 px-4 py-3 text-sm font-black text-fuchsia-100 shadow-[0_0_22px_rgba(232,121,249,.16)] transition active:scale-[0.98] disabled:opacity-40"
        >
          {adminCalling ? 'Викликаємо…' : '📞 Викликати Адміністратора'}
        </button>
      )}
    </section>
  );
}

export default function GuestWaiterCallController() {
  const [dialogTarget, setDialogTarget] = useState<HTMLElement | null>(null);
  const [bookings, setBookings] = useState<GuestBooking[]>(latestGuestBookings);

  useEffect(() => subscribeGuestBookings(setBookings), []);

  useEffect(() => {
    function syncDialogTarget() {
      setDialogTarget(
        document.querySelector<HTMLElement>(
          '[role="dialog"][aria-label="Мої бронювання"] > section',
        ),
      );
    }

    syncDialogTarget();
    const observer = new MutationObserver(syncDialogTarget);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, []);

  const activeApprovedBookings = useMemo(() => {
    const today = kyivDate();
    return bookings.filter(
      (booking) =>
        booking.status === 'approved' && booking.bookingDate >= today,
    );
  }, [bookings]);

  if (!dialogTarget || activeApprovedBookings.length === 0) return null;

  return createPortal(
    <div
      className="mt-4 space-y-3"
      aria-label="Виклики для активних бронювань"
    >
      {activeApprovedBookings.map((booking) => (
        <WaiterCallCard key={booking.bookingId} booking={booking} />
      ))}
    </div>,
    dialogTarget,
  );
}
