import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, Check, RefreshCw, X } from 'lucide-react';

import {
  adminAttentionApi,
  type AdminRescheduleRequest,
} from '../api/adminAttention';
import { getAccessToken } from '../api/client';

const POLLING_MS = 15_000;

function formatDate(value: string) {
  const [year, month, day] = String(value || '').split('-');
  return year && month && day ? `${day}.${month}.${year}` : value || '—';
}

function formatTime(value: string | null | undefined) {
  const [hours = '00', minutes = '00'] = String(value || '').split(':');
  return `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}`;
}

export default function AdminReschedulePanel() {
  const [requests, setRequests] = useState<AdminRescheduleRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!getAccessToken()) {
      setRequests([]);
      return;
    }

    if (!silent) setLoading(true);
    try {
      setRequests(await adminAttentionApi.getReschedules());
      setError(null);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Не вдалося завантажити запити на перенесення',
      );
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(true), POLLING_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  async function runAction(
    key: string,
    action: () => Promise<{ message: string }>,
  ) {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      const result = await action();
      setNotice(result.message);
      await load(true);
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : 'Не вдалося виконати дію',
      );
    } finally {
      setBusy(null);
    }
  }

  async function rejectReschedule(request: AdminRescheduleRequest) {
    const adminComment = window.prompt('Причина відмови для гостя', '');
    if (adminComment === null) return;

    await runAction(`reschedule:${request.id}:reject`, () =>
      adminAttentionApi.rejectReschedule(
        request.id,
        adminComment.trim() || undefined,
      ),
    );
  }

  return (
    <section
      className="mx-auto max-w-7xl px-3 pt-3 sm:px-4 lg:px-8"
      aria-label="Запити на перенесення бронювання для Адміністратора"
    >
      <div className="rounded-[28px] border border-amber-300/30 bg-black/80 p-3 shadow-[0_0_32px_rgba(251,191,36,.10)] backdrop-blur-xl">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-100/60">
              Потребує рішення Адміністратора
            </p>
            <h2 className="mt-1 text-lg font-black">
              Перенесення бронювання · {requests.length}
            </h2>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="grid h-11 w-11 place-items-center rounded-2xl border border-amber-200/45 bg-black/40 text-amber-100 shadow-[0_0_18px_rgba(251,191,36,.16)] disabled:opacity-40"
            aria-label="Оновити запити на перенесення"
          >
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {(notice || error) && (
          <div
            className={`mt-3 flex items-start justify-between gap-3 rounded-2xl border bg-black/45 px-3 py-2 text-sm ${
              error
                ? 'border-red-300/45 text-red-100'
                : 'border-emerald-300/45 text-emerald-100'
            }`}
          >
            <span>{error || notice}</span>
            <button
              type="button"
              onClick={() => {
                setError(null);
                setNotice(null);
              }}
              aria-label="Закрити повідомлення"
            >
              <X size={16} />
            </button>
          </div>
        )}

        <div className="mt-3 space-y-3">
          {requests.map((request) => (
            <article
              key={request.id}
              className="rounded-[24px] border border-amber-300/45 bg-black/50 p-4 shadow-[0_0_24px_rgba(251,191,36,.10)]"
            >
              <h3 className="flex items-center gap-2 text-lg font-black">
                <CalendarClock size={19} />
                Гість просить перенести бронювання
              </h3>

              <div className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                <Info
                  label="Гість"
                  value={request.booking.client?.fullName || '—'}
                />
                <Info
                  label="Стіл"
                  value={`№${request.booking.table?.tableNumber || '—'}`}
                />
                <Info
                  label="Було"
                  value={`${formatDate(request.booking.bookingDate)} · ${formatTime(request.booking.bookingTime)}`}
                />
                <Info
                  label="Просить"
                  value={`${formatDate(request.requestedDate)} · ${formatTime(request.requestedTime)}`}
                />
              </div>

              <p className="mt-3 text-sm text-white/55">
                Час бронювання зміниться тільки після підтвердження Адміністратора.
              </p>

              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() =>
                    void runAction(`reschedule:${request.id}:approve`, () =>
                      adminAttentionApi.approveReschedule(request.id),
                    )
                  }
                  className="rounded-2xl border border-emerald-300/50 bg-emerald-400/10 px-3 py-3 font-black text-emerald-100 disabled:opacity-35"
                >
                  Підтвердити
                </button>
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => void rejectReschedule(request)}
                  className="rounded-2xl border border-red-300/50 bg-red-400/10 px-3 py-3 font-black text-red-100 disabled:opacity-35"
                >
                  Відхилити
                </button>
              </div>
            </article>
          ))}

          {!requests.length && !error && (
            <div className="flex items-center gap-3 rounded-[22px] border border-emerald-300/30 bg-black/40 p-4 text-emerald-100">
              <span className="grid h-10 w-10 place-items-center rounded-2xl border border-emerald-300/45">
                <Check size={20} />
              </span>
              <div>
                <p className="font-black">Запитів на перенесення немає</p>
                <p className="text-xs text-white/45">Нові запити з’являться тут.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2">
      <p className="text-[10px] font-black uppercase tracking-[0.15em] text-white/35">
        {label}
      </p>
      <p className="mt-1 font-black text-white/85">{value}</p>
    </div>
  );
}
