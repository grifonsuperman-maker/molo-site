import { useCallback, useEffect, useState } from 'react';

import { bookingsApi, type GuestBooking } from '../../api/bookings';
import { readGuestBrowserAccess } from '../../api/guestAccessRuntime';
import { noShowNoticeApi } from '../services/noShowNoticeApi';

const POLLING_MS = 15_000;
const TABLE_CHANGE_TITLES = new Set([
  'Новий стіл підтверджено',
  'Поточний стіл залишено',
]);

type Decision = {
  booking: GuestBooking;
  token: string | null;
  guestDeviceId: string;
};

export default function GuestBookingDecisionController() {
  const [decision, setDecision] = useState<Decision | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { guestDeviceId, bookings: access } = readGuestBrowserAccess();
    if (!guestDeviceId && access.length === 0) {
      setDecision(null);
      return;
    }

    try {
      const bookings = await bookingsApi.guestList(
        guestDeviceId,
        access.map((item) => item.token),
      );
      const tokenFor = (bookingId: string) =>
        access.find((item) => item.bookingId === bookingId)?.token || null;
      const booking = bookings.find(
        (item) =>
          item.status === 'cancelled' &&
          item.guestNotification?.type === 'no_show' &&
          !item.guestNotification.acknowledgedAt &&
          Boolean(guestDeviceId) &&
          !tokenFor(item.bookingId),
      ) || bookings.find(
        (item) =>
          item.guestNotification &&
          !item.guestNotification.acknowledgedAt &&
          TABLE_CHANGE_TITLES.has(item.guestNotification.title || ''),
      );

      if (!booking) {
        setDecision(null);
        setError(null);
        return;
      }

      setDecision({
        booking,
        token: tokenFor(booking.bookingId),
        guestDeviceId,
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
    if (!decision) return;
    const { booking, token, guestDeviceId } = decision;
    const canAcknowledgeByDevice =
      !token &&
      Boolean(guestDeviceId) &&
      booking.status === 'cancelled' &&
      booking.guestNotification?.type === 'no_show';
    if (!token && !canAcknowledgeByDevice) return;

    setBusy(true);
    setError(null);
    try {
      if (token) {
        await bookingsApi.guestAcknowledgeNotification(booking.bookingId, token);
      } else {
        await noShowNoticeApi.acknowledgeByDevice(booking.bookingId, guestDeviceId);
      }
      setDecision(null);
      await load();
    } catch {
      setError('Не вдалося підтвердити повідомлення. Спробуйте ще раз.');
    } finally {
      setBusy(false);
    }
  }

  const canAcknowledge = Boolean(
    decision.token || (
      decision.guestDeviceId &&
      decision.booking.status === 'cancelled' &&
      decision.booking.guestNotification?.type === 'no_show'
    ),
  );

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
      {error && <p role="alert" className="mt-2 text-sm text-red-200">{error}</p>}
      {canAcknowledge && (
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
