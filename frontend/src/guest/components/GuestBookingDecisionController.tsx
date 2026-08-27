import { useCallback, useEffect, useState } from 'react';

import { bookingsApi, type GuestBooking } from '../../api/bookings';

const POLLING_MS = 15_000;
const GUEST_BOOKINGS_STORAGE_KEY = 'molo:guest:bookings:v1';
const GUEST_DEVICE_ID_STORAGE_KEY = 'molo:guest:device-id:v1';
const TABLE_CHANGE_TITLES = new Set([
  'Новий стіл підтверджено',
  'Поточний стіл залишено',
]);

type StoredBookingAccess = {
  bookingId: string;
  token: string;
};

type Decision = {
  booking: GuestBooking;
  token: string | null;
};

function readStoredAccess(): StoredBookingAccess[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(GUEST_BOOKINGS_STORAGE_KEY) || '[]');
    if (!Array.isArray(value)) return [];

    return value.filter(
      (item): item is StoredBookingAccess =>
        typeof item?.bookingId === 'string' &&
        Boolean(item.bookingId) &&
        typeof item?.token === 'string' &&
        Boolean(item.token),
    );
  } catch {
    return [];
  }
}

export default function GuestBookingDecisionController() {
  const [decision, setDecision] = useState<Decision | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const access = readStoredAccess();
    const guestDeviceId = window.localStorage.getItem(GUEST_DEVICE_ID_STORAGE_KEY) || '';
    if (!guestDeviceId && access.length === 0) {
      setDecision(null);
      return;
    }

    try {
      const bookings = await bookingsApi.guestList(
        guestDeviceId,
        access.map((item) => item.token),
      );
      const booking = bookings.find(
        (item) =>
          item.guestNotification &&
          !item.guestNotification.acknowledgedAt &&
          TABLE_CHANGE_TITLES.has(item.guestNotification.title || ''),
      );

      if (!booking) {
        setDecision(null);
        return;
      }

      setDecision({
        booking,
        token: access.find((item) => item.bookingId === booking.bookingId)?.token || null,
      });
    } catch {
      // Основний гостьовий застосунок продовжує працювати навіть без цього повідомлення.
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), POLLING_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  if (!decision?.booking.guestNotification) return null;

  async function acknowledge() {
    if (!decision?.token) return;
    setBusy(true);
    try {
      await bookingsApi.guestAcknowledgeNotification(
        decision.booking.bookingId,
        decision.token,
      );
      setDecision(null);
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="fixed left-3 right-3 top-3 z-[130] mx-auto max-w-xl rounded-[24px] border border-amber-200/60 bg-neutral-950/95 p-4 text-white shadow-[0_0_34px_rgba(251,191,36,.28)] backdrop-blur-xl">
      <p className="text-xs font-black uppercase tracking-[0.18em] text-amber-100/60">
        Оновлення бронювання
      </p>
      <h2 className="mt-1 text-lg font-black text-amber-100">
        {decision.booking.guestNotification.title}
      </h2>
      {decision.booking.guestNotification.message && (
        <p className="mt-2 text-sm leading-6 text-white/75">
          {decision.booking.guestNotification.message}
        </p>
      )}
      <p className="mt-2 text-xs text-white/45">
        {decision.booking.bookingDate} · {String(decision.booking.bookingTime).slice(0, 5)} · Стіл №{decision.booking.tableNumber || '—'}
      </p>
      {decision.token && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void acknowledge()}
          className="mt-3 w-full rounded-2xl border border-amber-200/60 bg-black/40 px-4 py-3 font-black text-amber-100 disabled:opacity-50"
        >
          {busy ? 'Зберігаємо…' : 'Ознайомився'}
        </button>
      )}
    </aside>
  );
}
