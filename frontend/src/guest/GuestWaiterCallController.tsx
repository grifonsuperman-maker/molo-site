import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import {
  bookingsApi,
  type GuestBooking,
  type GuestBookingToken,
} from '../api/bookings';
import {
  waiterCallsApi,
  type GuestWaiterCallStatus,
} from '../api/waiterCalls';

const GUEST_BOOKINGS_STORAGE_KEY = 'molo:guest:bookings:v1';
const GUEST_DEVICE_ID_STORAGE_KEY = 'molo:guest:device-id:v1';
const POLLING_INTERVAL_MS = 15_000;

type WaiterCallCardProps = {
  bookingId: string;
  tableNumber: string | null;
};

function errorText(error: unknown) {
  return error instanceof Error ? error.message : 'Сталася невідома помилка';
}

function readStoredGuestBookings(): GuestBookingToken[] {
  if (typeof window === 'undefined') return [];

  try {
    const value = JSON.parse(window.localStorage.getItem(GUEST_BOOKINGS_STORAGE_KEY) || '[]');
    if (!Array.isArray(value)) return [];

    return value.filter((item): item is GuestBookingToken =>
      typeof item?.bookingId === 'string' && Boolean(item.bookingId) &&
      typeof item?.token === 'string' && Boolean(item.token) &&
      typeof item?.createdAt === 'string' && Boolean(item.createdAt),
    );
  } catch {
    return [];
  }
}

function readGuestDeviceId() {
  if (typeof window === 'undefined') return '';

  try {
    return window.localStorage.getItem(GUEST_DEVICE_ID_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

function WaiterCallCard({ bookingId, tableNumber }: WaiterCallCardProps) {
  const [status, setStatus] = useState<GuestWaiterCallStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [calling, setCalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const loadStatus = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);

      const result = await waiterCallsApi.guestStatus(bookingId);
      setStatus(result);
      setError(null);
    } catch (loadError) {
      // Не прибираємо останній успішний статус через короткий збій мережі.
      setError(errorText(loadError));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [bookingId]);

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

      const result = await waiterCallsApi.createFromGuest(bookingId);
      setStatus((current) => ({
        bookingId,
        tableNumber: result.call.tableNumber || current?.tableNumber || tableNumber,
        bookingStatus: current?.bookingStatus || 'approved',
        tableStatus: current?.tableStatus || 'occupied',
        canCall: true,
        waiterAssigned: Boolean(result.call.waiterId || current?.waiterAssigned),
        waiterName: result.call.waiterName || current?.waiterName || null,
        activeCall: result.call,
      }));
      setMessage(result.message);
    } catch (callError) {
      setError(errorText(callError));
    } finally {
      setCalling(false);
    }
  }

  if (loading && !status) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-center text-sm text-white/55">
        Перевіряємо доступність виклику офіціанта…
      </div>
    );
  }

  if (error && !status) {
    return (
      <div className="rounded-2xl border border-red-300/30 bg-red-400/10 px-4 py-3 text-sm text-red-100">
        {error}
      </div>
    );
  }

  if (!status) return null;

  const call = status.activeCall;

  return (
    <section className="rounded-[24px] border border-amber-200/30 bg-black/35 p-4 backdrop-blur">
      <p className="text-sm font-black text-white">Потрібен офіціант?</p>
      <p className="mt-1 text-xs leading-5 text-white/55">
        Стіл №{status.tableNumber || tableNumber || '—'}
      </p>

      {error && (
        <div className="mt-3 rounded-2xl border border-red-300/30 bg-red-400/10 px-3 py-2 text-sm text-red-100">
          {error}
        </div>
      )}

      {message && (
        <div className="mt-3 rounded-2xl border border-emerald-300/30 bg-emerald-400/10 px-3 py-2 text-sm font-semibold text-emerald-100">
          {message}
        </div>
      )}

      {call && (
        <div className="mt-3 rounded-2xl border border-amber-200/30 bg-amber-300/10 px-4 py-3 text-amber-100">
          <p className="text-sm font-black">
            {call.status === 'accepted'
              ? 'Офіціант прийняв виклик'
              : 'Виклик офіціанта відправлено'}
          </p>
          <p className="mt-1 text-xs text-amber-100/70">
            {call.waiterName
              ? `Офіціант: ${call.waiterName}`
              : 'Виклик у загальному списку офіціантів'}
          </p>
        </div>
      )}

      {!call && status.canCall && (
        <button
          type="button"
          onClick={callWaiter}
          disabled={calling}
          className="mt-3 w-full rounded-2xl border border-amber-200/60 bg-amber-300/20 px-4 py-3 text-sm font-black text-amber-100 transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {calling ? 'Викликаємо…' : '🔔 Викликати офіціанта'}
        </button>
      )}

      {!call && !status.canCall && (
        <p className="mt-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-xs leading-5 text-white/50">
          Виклик офіціанта стане доступним після того, як адміністратор або офіціант відмітить: «Гість прийшов».
        </p>
      )}
    </section>
  );
}

export default function GuestWaiterCallController() {
  const [dialogTarget, setDialogTarget] = useState<HTMLElement | null>(null);
  const [bookings, setBookings] = useState<GuestBooking[]>([]);

  const loadBookings = useCallback(async () => {
    const storedBookings = readStoredGuestBookings();
    const guestDeviceId = readGuestDeviceId();

    if (!guestDeviceId && storedBookings.length === 0) {
      setBookings([]);
      return;
    }

    try {
      const result = await bookingsApi.guestList(
        guestDeviceId,
        storedBookings.map((booking) => booking.token),
      );
      setBookings(result.filter((booking) => booking.status === 'approved'));
    } catch {
      // Коротка помилка не прибирає вже показані бронювання та кнопку.
    }
  }, []);

  useEffect(() => {
    void loadBookings();

    const interval = window.setInterval(() => {
      void loadBookings();
    }, POLLING_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [loadBookings]);

  useEffect(() => {
    function syncDialogTarget() {
      const target = document.querySelector<HTMLElement>(
        '[role="dialog"][aria-label="Мої бронювання"] > section',
      );
      setDialogTarget(target);
    }

    syncDialogTarget();
    const observer = new MutationObserver(syncDialogTarget);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, []);

  if (!dialogTarget || bookings.length === 0) return null;

  return createPortal(
    <div className="mt-4 space-y-3" aria-label="Виклик офіціанта для активних бронювань">
      {bookings.map((booking) => (
        <WaiterCallCard
          key={booking.bookingId}
          bookingId={booking.bookingId}
          tableNumber={booking.tableNumber}
        />
      ))}
    </div>,
    dialogTarget,
  );
}
