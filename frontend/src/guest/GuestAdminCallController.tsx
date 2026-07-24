import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import { adminAttentionApi, type GuestAdminCallStatus } from '../api/adminAttention';
import { bookingsApi, type GuestBooking } from '../api/bookings';

const POLLING_INTERVAL_MS = 15_000;

type GuestBookingListener = (bookings: GuestBooking[]) => void;

let latestGuestBookings: GuestBooking[] = [];
const guestBookingListeners = new Set<GuestBookingListener>();
const previousGuestList = bookingsApi.guestList;

bookingsApi.guestList = async (guestDeviceId: string, tokens: string[] = []) => {
  const bookings = await previousGuestList(guestDeviceId, tokens);
  latestGuestBookings = bookings;
  guestBookingListeners.forEach((listener) => listener(bookings));
  return bookings;
};

function subscribe(listener: GuestBookingListener) {
  guestBookingListeners.add(listener);
  listener(latestGuestBookings);
  return () => guestBookingListeners.delete(listener);
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : 'Сталася невідома помилка';
}

function AdminCallCard({ booking }: { booking: GuestBooking }) {
  const [status, setStatus] = useState<GuestAdminCallStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [calling, setCalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      setStatus(await adminAttentionApi.guestAdminCallStatus(booking.bookingId));
      setError(null);
    } catch (loadError) {
      setError(errorText(loadError));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [booking.bookingId]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(true), POLLING_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  async function callAdmin() {
    try {
      setCalling(true);
      setError(null);
      setMessage(null);
      const result = await adminAttentionApi.createGuestAdminCall(booking.bookingId);
      setStatus((current) => ({
        bookingId: booking.bookingId,
        tableNumber: result.call.tableNumber || booking.tableNumber,
        bookingStatus: current?.bookingStatus || booking.status,
        canCall: true,
        activeCall: result.call,
      }));
      setMessage(result.message);
    } catch (callError) {
      setError(errorText(callError));
    } finally {
      setCalling(false);
    }
  }

  const activeCall = status?.activeCall || null;

  return (
    <section className="rounded-[24px] border border-fuchsia-300/35 bg-black/35 p-4 text-left shadow-[0_0_28px_rgba(217,70,239,.10)] backdrop-blur">
      <p className="text-sm font-black text-white">Потрібен Адміністратор?</p>
      <p className="mt-1 text-xs leading-5 text-white/55">
        {booking.bookingDate} · {String(booking.bookingTime).slice(0, 5)} · Стіл №{status?.tableNumber || booking.tableNumber || '—'}
      </p>

      {loading && !status && (
        <p className="mt-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-xs text-white/55">
          Перевіряємо доступність виклику…
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
        <div className="mt-3 rounded-2xl border border-fuchsia-300/35 bg-fuchsia-400/10 px-4 py-3 text-fuchsia-100">
          <p className="text-sm font-black">
            {activeCall.status === 'accepted'
              ? 'Адміністратор прийняв виклик'
              : 'Виклик Адміністратора відправлено'}
          </p>
          <p className="mt-1 text-xs text-fuchsia-100/70">
            {activeCall.status === 'accepted'
              ? 'Адміністратор уже прямує до вас.'
              : 'Очікуйте підтвердження у пульті Адміністратора.'}
          </p>
        </div>
      )}

      {!loading && status && !activeCall && status.canCall && (
        <button
          type="button"
          onClick={callAdmin}
          disabled={calling}
          className="mt-3 w-full rounded-2xl border border-fuchsia-300/65 bg-fuchsia-400/10 px-4 py-3 text-sm font-black text-fuchsia-100 shadow-[0_0_22px_rgba(217,70,239,.16)] transition active:scale-[0.98] disabled:opacity-40"
        >
          {calling ? 'Викликаємо…' : '📣 Викликати Адміністратора'}
        </button>
      )}
    </section>
  );
}

export default function GuestAdminCallController() {
  const [dialogTarget, setDialogTarget] = useState<HTMLElement | null>(null);
  const [bookings, setBookings] = useState<GuestBooking[]>(latestGuestBookings);

  useEffect(() => subscribe(setBookings), []);

  useEffect(() => {
    const sync = () => {
      setDialogTarget(
        document.querySelector<HTMLElement>(
          '[role="dialog"][aria-label="Мої бронювання"] > section',
        ),
      );
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  const checkedInBookings = useMemo(
    () =>
      bookings.filter(
        (booking) => booking.status === 'approved' && Boolean(booking.checkedInAt),
      ),
    [bookings],
  );

  if (!dialogTarget || checkedInBookings.length === 0) return null;

  return createPortal(
    <div className="mt-4 space-y-3" aria-label="Виклик Адміністратора">
      {checkedInBookings.map((booking) => (
        <AdminCallCard key={booking.bookingId} booking={booking} />
      ))}
    </div>,
    dialogTarget,
  );
}
