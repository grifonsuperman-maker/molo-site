import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import { adminAttentionApi, type GuestAdminCallStatus } from '../api/adminAttention';
import { bookingsApi, type GuestBooking } from '../api/bookings';

const POLLING_INTERVAL_MS = 15_000;

type GuestBookingListener = (bookings: GuestBooking[]) => void;

let latestBookings: GuestBooking[] = [];
const listeners = new Set<GuestBookingListener>();
const previousGuestList = bookingsApi.guestList;

bookingsApi.guestList = async (guestDeviceId: string, tokens: string[] = []) => {
  const bookings = await previousGuestList(guestDeviceId, tokens);
  latestBookings = bookings;
  listeners.forEach((listener) => listener(bookings));
  return bookings;
};

bookingsApi.guestChangeTable = async (id, token, table) => {
  const response = await adminAttentionApi.requestTableChange(id, token, {
    tableNumber: table.tableNumber || null,
  });
  return {
    ...response,
    booking: await bookingsApi.getGuest(id, token),
  };
};

function subscribe(listener: GuestBookingListener) {
  listeners.add(listener);
  listener(latestBookings);
  return () => {
    listeners.delete(listener);
  };
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : 'Сталася невідома помилка';
}

function AdminCallCard({ booking }: { booking: GuestBooking }) {
  const [status, setStatus] = useState<GuestAdminCallStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [calling, setCalling] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      setMessage(result.message || 'Адміністратора викликано');
      await load(true);
    } catch (callError) {
      setError(errorText(callError));
    } finally {
      setCalling(false);
    }
  }

  const activeCall = status?.activeCall || null;

  return (
    <section className="rounded-[24px] border border-fuchsia-300/30 bg-black/35 p-4 text-left shadow-[0_0_24px_rgba(217,70,239,.08)] backdrop-blur">
      <p className="text-sm font-black text-white">Потрібен Адміністратор?</p>
      <p className="mt-1 text-xs leading-5 text-white/55">
        {booking.bookingDate} · {String(booking.bookingTime).slice(0, 5)} · Стіл №{status?.tableNumber || booking.tableNumber || '—'}
      </p>

      {loading && !status && <p className="mt-3 text-xs text-white/50">Перевіряємо виклик…</p>}
      {error && <p className="mt-3 rounded-2xl border border-red-300/30 bg-red-400/10 px-4 py-3 text-xs text-red-100">{error}</p>}
      {message && <p className="mt-3 rounded-2xl border border-emerald-300/30 bg-emerald-400/10 px-4 py-3 text-xs font-semibold text-emerald-100">{message}</p>}

      {activeCall && (
        <div className="mt-3 rounded-2xl border border-fuchsia-300/35 bg-fuchsia-400/10 px-4 py-3 text-fuchsia-100">
          <p className="text-sm font-black">
            {activeCall.status === 'accepted' ? 'Адміністратор прийняв виклик' : 'Виклик Адміністратора відправлено'}
          </p>
          <p className="mt-1 text-xs text-fuchsia-100/70">Очікуйте, будь ласка.</p>
        </div>
      )}

      {!loading && status && !activeCall && status.canCall && (
        <button
          type="button"
          onClick={callAdmin}
          disabled={calling}
          className="mt-3 w-full rounded-2xl border border-fuchsia-300/60 bg-fuchsia-400/10 px-4 py-3 text-sm font-black text-fuchsia-100 shadow-[0_0_20px_rgba(217,70,239,.2)] transition active:scale-[0.98] disabled:opacity-40"
        >
          {calling ? 'Викликаємо…' : '📣 Викликати Адміністратора'}
        </button>
      )}

      {!loading && status && !activeCall && !status.canCall && (
        <p className="mt-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-xs leading-5 text-white/50">
          Виклик стане доступним після позначки «Гість прийшов».
        </p>
      )}
    </section>
  );
}

export default function GuestAdminAttentionController() {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [bookings, setBookings] = useState<GuestBooking[]>(latestBookings);

  useEffect(() => subscribe(setBookings), []);

  useEffect(() => {
    const syncTarget = () => {
      setTarget(document.querySelector<HTMLElement>('[role="dialog"][aria-label="Мої бронювання"] > section'));
    };
    syncTarget();
    const observer = new MutationObserver(syncTarget);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  const approvedBookings = useMemo(
    () => bookings.filter((booking) => booking.status === 'approved'),
    [bookings],
  );

  if (!target || approvedBookings.length === 0) return null;

  return createPortal(
    <div className="mt-4 space-y-3" aria-label="Виклик Адміністратора для активних бронювань">
      {approvedBookings.map((booking) => (
        <AdminCallCard key={booking.bookingId} booking={booking} />
      ))}
    </div>,
    target,
  );
}
