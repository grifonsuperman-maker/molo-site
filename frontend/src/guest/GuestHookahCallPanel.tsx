import { useCallback, useEffect, useState } from 'react';

import {
  hookahCallsApi,
  type GuestHookahStatus,
} from '../api/hookah-calls';

type GuestHookahCallPanelProps = {
  bookingId: string;
  guestToken: string;
};

function errorText(error: unknown) {
  return error instanceof Error ? error.message : 'Сталася невідома помилка';
}

export default function GuestHookahCallPanel({
  bookingId,
  guestToken,
}: GuestHookahCallPanelProps) {
  const [status, setStatus] = useState<GuestHookahStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [calling, setCalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const loadStatus = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);

      const result = await hookahCallsApi.getGuestStatus(bookingId, guestToken);
      setStatus(result);
      setError(null);
    } catch (loadError) {
      setError(errorText(loadError));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [bookingId, guestToken]);

  useEffect(() => {
    void loadStatus();

    const interval = window.setInterval(() => {
      void loadStatus(true);
    }, 15_000);

    return () => window.clearInterval(interval);
  }, [loadStatus]);

  async function callHookahWorker() {
    try {
      setCalling(true);
      setError(null);
      setMessage(null);

      const result = await hookahCallsApi.createFromGuest(bookingId, guestToken);

      setStatus((current) => ({
        bookingId,
        bookingStatus: current?.bookingStatus || 'approved',
        tableStatus: current?.tableStatus || 'occupied',
        tableNumber: result.call.tableNumber || current?.tableNumber || null,
        zoneName: result.call.zoneName || current?.zoneName || null,
        canCall: false,
        activeCall: result.call,
      }));

      setMessage(result.message);
    } catch (callError) {
      setError(errorText(callError));
    } finally {
      setCalling(false);
    }
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-center text-sm text-white/55">
        Перевіряємо доступність кальянника…
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
      <div>
        <p className="text-sm font-black text-white">
          Бажаєте кальян?
        </p>

        <p className="mt-1 text-xs leading-5 text-white/55">
          {status.tableNumber
            ? `Стіл №${status.tableNumber}${status.zoneName ? ` · ${status.zoneName}` : ''}`
            : 'Ваш стіл'}
        </p>
      </div>

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

      {call?.status === 'new' && (
        <div className="mt-3 rounded-2xl border border-amber-200/30 bg-amber-300/10 px-4 py-3">
          <p className="text-sm font-black text-amber-100">
            Кальянника викликано
          </p>
          <p className="mt-1 text-xs text-amber-100/70">
            Очікуємо, поки працівник прийме виклик.
          </p>
        </div>
      )}

      {call?.status === 'accepted' && (
        <div className="mt-3 rounded-2xl border border-emerald-200/30 bg-emerald-300/10 px-4 py-3">
          <p className="text-sm font-black text-emerald-100">
            Кальянник уже прямує до вас
          </p>

          <p className="mt-1 text-xs text-emerald-100/75">
            {call.acceptedByStaffName
              ? `${call.acceptedByStaffName} прийняв виклик.`
              : 'Виклик прийнято.'}
            {call.etaMinutes
              ? ` Орієнтовний час очікування — ${call.etaMinutes} хв.`
              : ''}
          </p>
        </div>
      )}

      {!call && status.canCall && (
        <button
          type="button"
          onClick={callHookahWorker}
          disabled={calling}
          className="mt-3 w-full rounded-2xl border border-amber-200/60 bg-amber-300/20 px-4 py-3 text-sm font-black text-amber-100 transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {calling ? 'Викликаємо…' : 'Викликати кальянника'}
        </button>
      )}

      {!call && !status.canCall && (
        <p className="mt-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-xs leading-5 text-white/50">
          Виклик кальянника стане доступним після підтвердження бронювання та вашого приходу за стіл.
        </p>
      )}
    </section>
  );
}
