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
  bookingId: string | null;
  noticeHandle: string | null;
  guestNotification: NonNullable<GuestBooking['guestNotification']>;
  token: string | null;
  guestDeviceId: string;
  isNoShow: boolean;
  bookingDate?: string;
  bookingTime?: string;
  tableNumber?: string | number | null;
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
      const [bookingsResult, noticesResult] = await Promise.allSettled([
        bookingsApi.guestList(guestDeviceId, access.map((item) => item.token)),
        guestDeviceId
          ? noShowNoticeApi.listUnreadForDevice(guestDeviceId)
          : Promise.resolve([]),
      ]);
      if (bookingsResult.status === 'rejected' && noticesResult.status === 'rejected') return;
      const bookings = bookingsResult.status === 'fulfilled' ? bookingsResult.value : [];
      const notices = noticesResult.status === 'fulfilled' ? noticesResult.value : [];
      const tokenFor = (bookingId: string) =>
        access.find((item) => item.bookingId === bookingId)?.token || null;
      const notice = notices[0];
      if (notice) {
        setDecision({
          bookingId: null,
          noticeHandle: notice.noticeHandle,
          guestNotification: notice.guestNotification,
          token: null,
          guestDeviceId,
          isNoShow: true,
        });
        setError(null);
        return;
      }

      const booking = bookings.find(
        (item) =>
          item.guestNotification &&
          !item.guestNotification.acknowledgedAt &&
          TABLE_CHANGE_TITLES.has(item.guestNotification.title || ''),
      );

      if (!booking?.guestNotification) {
        // A temporary failure of either independent endpoint must not dismiss its notice.
        if (bookingsResult.status === 'rejected' || noticesResult.status === 'rejected') return;
        setDecision(null);
        setError(null);
        return;
      }

      // A successful table-change poll must not replace a displayed no-show whose own poll failed.
      setDecision((current) => {
        if (noticesResult.status === 'rejected' && current?.isNoShow) return current;
        return {
          bookingId: booking.bookingId,
          noticeHandle: null,
          guestNotification: booking.guestNotification!,
          token: tokenFor(booking.bookingId),
          guestDeviceId,
          isNoShow: false,
          bookingDate: booking.bookingDate,
          bookingTime: booking.bookingTime,
          tableNumber: booking.tableNumber,
        };
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

  if (!decision) return null;

  async function acknowledge() {
    if (!decision) return;
    const { bookingId, noticeHandle, token, guestDeviceId, isNoShow } = decision;
    if (!(token && bookingId) && !(isNoShow && noticeHandle && guestDeviceId)) return;

    setBusy(true);
    setError(null);
    try {
      if (isNoShow && noticeHandle && guestDeviceId) {
        await noShowNoticeApi.acknowledgeByDevice(noticeHandle, guestDeviceId);
      } else if (token && bookingId) {
        await bookingsApi.guestAcknowledgeNotification(bookingId, token);
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
    (decision.token && decision.bookingId) ||
    (decision.isNoShow && decision.noticeHandle && decision.guestDeviceId),
  );

  return (
    <aside className="fixed left-3 right-3 top-3 z-[130] mx-auto max-w-xl rounded-[24px] border border-amber-200/60 bg-neutral-950/95 p-4 text-white shadow-[0_0_34px_rgba(251,191,36,.28)] backdrop-blur-xl">
      <p className="text-xs font-black uppercase tracking-[0.18em] text-amber-100/60">
        Оновлення бронювання
      </p>
      <h2 className="mt-1 text-lg font-black text-amber-100">
        {decision.guestNotification.title}
      </h2>
      {decision.guestNotification.message && (
        <p className="mt-2 text-sm leading-6 text-white/75">
          {decision.guestNotification.message}
        </p>
      )}
      {!decision.isNoShow && decision.bookingDate && (
        <p className="mt-2 text-xs text-white/45">
          {decision.bookingDate} · {String(decision.bookingTime || '').slice(0, 5)} · Стіл №{decision.tableNumber || '—'}
        </p>
      )}
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
