import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import { bookingsApi, type GuestBooking } from '../api/bookings';

type Listener = (bookings: GuestBooking[]) => void;

let latestBookings: GuestBooking[] = [];
const listeners = new Set<Listener>();
const originalGuestList = bookingsApi.guestList;

function publish(bookings: GuestBooking[]) {
  latestBookings = bookings;
  listeners.forEach((listener) => listener(bookings));
}

bookingsApi.guestList = async (guestDeviceId: string, tokens: string[] = []) => {
  const bookings = await originalGuestList(guestDeviceId, tokens);
  publish(bookings);
  return bookings;
};

function subscribe(listener: Listener) {
  listeners.add(listener);
  listener(latestBookings);
  return () => listeners.delete(listener);
}

export default function GuestBookingNotificationController() {
  const [bookings, setBookings] = useState<GuestBooking[]>(latestBookings);
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => subscribe(setBookings), []);

  useEffect(() => {
    function syncTarget() {
      setTarget(
        document.querySelector<HTMLElement>(
          '[role="dialog"][aria-label="Мої бронювання"] > section',
        ),
      );
    }

    syncTarget();
    const observer = new MutationObserver(syncTarget);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  const notifications = useMemo(
    () => bookings.filter(
      (booking) =>
        booking.status !== 'cancelled' &&
        Boolean(booking.guestNotification) &&
        !booking.guestNotification?.acknowledgedAt,
    ),
    [bookings],
  );

  async function acknowledge(booking: GuestBooking) {
    const tokenRecord = readToken(booking.bookingId);
    if (!tokenRecord) {
      setError('Не вдалося підтвердити повідомлення. Відкрийте бронювання ще раз.');
      return;
    }

    setBusy(booking.bookingId);
    setError(null);
    try {
      await bookingsApi.guestAcknowledgeNotification(booking.bookingId, tokenRecord.token);
      publish(latestBookings.map((item) =>
        item.bookingId === booking.bookingId
          ? {
              ...item,
              guestNotification: item.guestNotification
                ? { ...item.guestNotification, acknowledgedAt: new Date().toISOString() }
                : null,
            }
          : item,
      ));
    } catch (ackError) {
      setError(ackError instanceof Error ? ackError.message : 'Не вдалося підтвердити повідомлення');
    } finally {
      setBusy(null);
    }
  }

  if (!target || notifications.length === 0) return null;

  return createPortal(
    <div className="mt-4 space-y-3" aria-label="Рішення Адміністратора щодо бронювання">
      {error && (
        <p className="rounded-2xl border border-red-300/35 bg-red-400/10 p-3 text-sm text-red-100">
          {error}
        </p>
      )}
      {notifications.map((booking) => (
        <section key={booking.bookingId} className="rounded-2xl border border-fuchsia-300/45 bg-fuchsia-400/10 p-4 text-left shadow-[0_0_24px_rgba(217,70,239,.18)]">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-fuchsia-100/70">Повідомлення Адміністратора</p>
          <h3 className="mt-2 font-black text-fuchsia-50">
            {booking.guestNotification?.title || 'Бронювання оновлено'}
          </h3>
          {booking.guestNotification?.message && (
            <p className="mt-2 text-sm leading-6 text-white/75">
              {booking.guestNotification.message}
            </p>
          )}
          <p className="mt-2 text-xs text-white/45">
            {booking.bookingDate} · {String(booking.bookingTime).slice(0, 5)} · Стіл №{booking.tableNumber || '—'}
          </p>
          <button
            type="button"
            disabled={busy === booking.bookingId}
            onClick={() => void acknowledge(booking)}
            className="mt-3 rounded-xl border border-fuchsia-200/60 bg-transparent px-4 py-2 text-sm font-black text-fuchsia-100 shadow-[0_0_18px_rgba(217,70,239,.16)] disabled:opacity-45"
          >
            {busy === booking.bookingId ? 'Зберігаємо…' : 'Зрозуміло'}
          </button>
        </section>
      ))}
    </div>,
    target,
  );
}

function readToken(bookingId: string): { bookingId: string; token: string } | null {
  try {
    const parsed = JSON.parse(localStorage.getItem('molo:guest:bookings:v1') || '[]');
    if (!Array.isArray(parsed)) return null;
    const item = parsed.find((value) => value?.bookingId === bookingId && typeof value?.token === 'string');
    return item || null;
  } catch {
    return null;
  }
}
