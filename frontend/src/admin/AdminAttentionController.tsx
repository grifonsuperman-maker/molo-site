import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  BellRing,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  MessageSquareText,
  MoveRight,
  PhoneCall,
  UserRound,
} from 'lucide-react';

import {
  adminAttentionApi,
  type AdminAttentionItem,
} from '../api/adminAttention';
import { bookingsApi } from '../api/bookings';
import { mapApi } from '../api/map';
import type { FullMapResponse, TableItem } from '../api/types';

const POLLING_MS = 15_000;
const SOUND_REPEAT_MS = 5_000;
const SOUND_ENABLED_KEY = 'molo_admin_sound_enabled_v1';
const NEW_SOUND_KINDS = new Set(['reschedule', 'table_change', 'review', 'admin_call']);

function formatDate(value: string | undefined) {
  const [year, month, day] = String(value || '').split('-');
  return year && month && day ? `${day}.${month}.${year}` : value || '—';
}

function formatTime(value: string | undefined) {
  return String(value || '').slice(0, 5) || '—';
}

function title(item: AdminAttentionItem) {
  return {
    booking_created: 'Нове бронювання',
    guest_cancelled: 'Гість скасував бронювання',
    guest_reported_lateness: 'Гість запізнюється',
    reschedule: 'Запит змінити дату або час',
    table_change: 'Запит змінити стіл',
    review: 'Новий відгук гостя',
    admin_call: item.status === 'accepted' ? 'Виклик Адміністратора прийнято' : 'Гість викликає Адміністратора',
  }[item.kind];
}

function accent(item: AdminAttentionItem) {
  return {
    booking_created: 'border-sky-300/65 shadow-[0_0_42px_rgba(56,189,248,.22)]',
    guest_cancelled: 'border-red-300/65 shadow-[0_0_42px_rgba(248,113,113,.22)]',
    guest_reported_lateness: 'border-amber-200/70 shadow-[0_0_42px_rgba(251,191,36,.24)]',
    reschedule: 'border-violet-300/70 shadow-[0_0_44px_rgba(196,181,253,.24)]',
    table_change: 'border-fuchsia-300/70 shadow-[0_0_44px_rgba(232,121,249,.24)]',
    review: 'border-cyan-200/65 shadow-[0_0_42px_rgba(103,232,249,.2)]',
    admin_call: 'border-rose-300/80 shadow-[0_0_58px_rgba(251,113,133,.38)]',
  }[item.kind];
}

function readSoundEnabled() {
  try {
    return localStorage.getItem(SOUND_ENABLED_KEY) !== 'false';
  } catch {
    return true;
  }
}

function findActiveTab(label: string) {
  const nav = document.querySelector<HTMLElement>('.molo-admin-workspace > main > nav');
  const button = Array.from(nav?.querySelectorAll<HTMLButtonElement>('button') || [])
    .find((item) => item.textContent?.trim() === label);
  return Boolean(button?.className.includes('bg-amber-300'));
}

function restoreLegacyAttention() {
  document
    .querySelectorAll<HTMLElement>('[data-molo-legacy-attention-hidden="true"]')
    .forEach((element) => {
      element.style.display = element.dataset.moloPreviousDisplay || '';
      delete element.dataset.moloPreviousDisplay;
      delete element.dataset.moloLegacyAttentionHidden;
    });
}

export default function AdminAttentionController() {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [items, setItems] = useState<AdminAttentionItem[]>([]);
  const [map, setMap] = useState<FullMapResponse | null>(null);
  const [index, setIndex] = useState(0);
  const [selectedTableId, setSelectedTableId] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const audioUnlockedRef = useRef(false);

  async function load(silent = false) {
    if (!silent) setLoading(true);
    try {
      const [attention, fullMap] = await Promise.all([
        adminAttentionApi.list(),
        map ? Promise.resolve(map) : mapApi.get(),
      ]);
      setItems(attention);
      if (!map) setMap(fullMap);
      setError(null);
    } catch (loadError: any) {
      setError(loadError?.message || 'Не вдалося завантажити події');
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(true), POLLING_MS);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const unlock = () => {
      audioUnlockedRef.current = true;
      const AudioContextClass = window.AudioContext ||
        (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;
      const context = audioRef.current || new AudioContextClass();
      audioRef.current = context;
      if (context.state === 'suspended') void context.resume();
    };
    document.addEventListener('pointerdown', unlock, { passive: true });
    return () => document.removeEventListener('pointerdown', unlock);
  }, []);

  useEffect(() => {
    const syncTarget = () => {
      const main = document.querySelector<HTMLElement>('.molo-admin-workspace > main');
      if (!main || !findActiveTab('Головна')) {
        restoreLegacyAttention();
        setTarget(null);
        return;
      }

      const section = Array.from(main.children).find(
        (child): child is HTMLElement => child instanceof HTMLElement && child.tagName === 'SECTION',
      );
      if (!section) return;

      let mount = section.querySelector<HTMLElement>(':scope > [data-admin-attention-mount]');
      if (!mount) {
        mount = document.createElement('div');
        mount.dataset.adminAttentionMount = 'true';
        section.insertBefore(mount, section.firstChild);
      }

      const legacy = Array.from(section.children).find((child) => {
        if (!(child instanceof HTMLElement) || child === mount) return false;
        const text = child.textContent || '';
        return text.includes('Потребує уваги') || text.includes('Усе спокійно');
      }) as HTMLElement | undefined;
      if (legacy && legacy.dataset.moloLegacyAttentionHidden !== 'true') {
        legacy.dataset.moloPreviousDisplay = legacy.style.display;
        legacy.dataset.moloLegacyAttentionHidden = 'true';
        legacy.style.display = 'none';
      }
      setTarget(mount);
    };

    syncTarget();
    const observer = new MutationObserver(syncTarget);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
    });
    return () => {
      observer.disconnect();
      restoreLegacyAttention();
    };
  }, []);

  const current = items[index] || null;

  useEffect(() => {
    if (index >= items.length) setIndex(0);
  }, [index, items.length]);

  useEffect(() => {
    setSelectedTableId(current?.requestedTableId || '');
  }, [current?.id]);

  const candidateTables = useMemo(() => {
    if (!current || current.kind !== 'table_change') return [];
    return [...(map?.tables || [])]
      .filter((table) =>
        table.isVisible &&
        table.status !== 'closed' &&
        table.id !== current.booking.table?.id &&
        Number(table.seats) >= Number(current.booking.guestsCount),
      )
      .sort((left, right) => Number(left.tableNumber) - Number(right.tableNumber));
  }, [current, map]);

  function playAttentionSound() {
    if (!audioUnlockedRef.current || !readSoundEnabled()) return;
    try {
      const AudioContextClass = window.AudioContext ||
        (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;
      const context = audioRef.current || new AudioContextClass();
      audioRef.current = context;
      const now = context.currentTime;
      [660, 880, 1040].forEach((frequency, note) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const start = now + note * 0.16;
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(frequency, start);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.42, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.14);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(start);
        oscillator.stop(start + 0.15);
      });
    } catch {
      // Мобільний браузер може чекати першого натискання користувача.
    }
  }

  const newSoundIds = useMemo(
    () => items.filter((item) => NEW_SOUND_KINDS.has(item.kind)).map((item) => item.id).join('|'),
    [items],
  );

  useEffect(() => {
    if (!newSoundIds) return;
    playAttentionSound();
    const timer = window.setInterval(playAttentionSound, SOUND_REPEAT_MS);
    return () => window.clearInterval(timer);
  }, [newSoundIds]);

  async function run(action: () => Promise<{ message: string }>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await action();
      setNotice(result.message);
      await load(true);
    } catch (actionError: any) {
      setError(actionError?.message || 'Не вдалося виконати дію');
    } finally {
      setBusy(false);
    }
  }

  function openBookings() {
    const nav = document.querySelector<HTMLElement>('.molo-admin-workspace > main > nav');
    const button = Array.from(nav?.querySelectorAll<HTMLButtonElement>('button') || [])
      .find((item) => item.textContent?.trim() === 'Броні');
    button?.click();
  }

  if (!target) return null;

  return createPortal(
    <div className="mb-3" data-admin-attention-root>
      {error && (
        <p className="mb-2 rounded-2xl border border-red-300/50 bg-black/70 px-3 py-2 text-sm text-red-100 shadow-[0_0_28px_rgba(248,113,113,.18)]">
          {error}
        </p>
      )}
      {notice && (
        <p className="mb-2 rounded-2xl border border-emerald-300/45 bg-black/70 px-3 py-2 text-sm text-emerald-100 shadow-[0_0_26px_rgba(52,211,153,.16)]">
          {notice}
        </p>
      )}

      {!current ? (
        <article className="rounded-[28px] border border-emerald-300/35 bg-black/70 p-4 shadow-[0_0_32px_rgba(52,211,153,.12)]">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-2xl border border-emerald-300/45 text-emerald-100 shadow-[0_0_20px_rgba(52,211,153,.18)]">
              <Check size={22} />
            </span>
            <div>
              <p className="font-black">Усе спокійно</p>
              <p className="text-sm text-white/45">Подій, що потребують реакції, немає.</p>
            </div>
          </div>
        </article>
      ) : (
        <article className={`animate-pulse rounded-[28px] border bg-black/75 p-4 ${accent(current)}`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em] text-white/75">
                <BellRing size={16} /> Потребує уваги
              </p>
              <h2 className="mt-2 text-xl font-black">{title(current)}</h2>
            </div>
            {items.length > 1 && (
              <div className="flex items-center gap-1 rounded-xl border border-white/20 bg-black/50 p-1">
                <button type="button" onClick={() => setIndex((index - 1 + items.length) % items.length)} className="p-1"><ChevronLeft size={17} /></button>
                <span className="px-1 text-xs">{index + 1}/{items.length}</span>
                <button type="button" onClick={() => setIndex((index + 1) % items.length)} className="p-1"><ChevronRight size={17} /></button>
              </div>
            )}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <Info icon={<UserRound size={14} />} label="Гість" value={current.booking.client?.fullName || '—'} />
            <Info label="Стіл" value={`№${current.booking.table?.tableNumber || '—'}`} />
            <Info label="Дата і час" value={`${formatDate(current.booking.bookingDate)} · ${formatTime(current.booking.bookingTime)}`} />
            <Info label="Гостей" value={String(current.booking.guestsCount || 0)} />
          </div>

          {current.kind === 'guest_reported_lateness' && (
            <Detail icon={<Clock3 size={16} />}>
              {current.reason || `Запізнення: ${Number(current.booking.latenessHours || 0) * 60 + Number(current.booking.latenessMinutes || 0)} хв`}
            </Detail>
          )}

          {current.kind === 'reschedule' && (
            <Detail icon={<Clock3 size={16} />}>
              <span className="block">Було: {formatDate(current.booking.bookingDate)} · {formatTime(current.booking.bookingTime)}</span>
              <span className="mt-1 block font-black">Запит: {formatDate(current.requestedDate)} · {formatTime(current.requestedTime)}</span>
            </Detail>
          )}

          {current.kind === 'table_change' && (
            <div className="mt-3 rounded-2xl border border-fuchsia-200/30 bg-black/45 p-3">
              <p className="flex items-center gap-2 text-sm">
                <MoveRight size={16} /> Поточний стіл №{current.previousTableNumber || current.booking.table?.tableNumber || '—'}; бажаний №{current.requestedTableNumber || '—'}
              </p>
              <label className="mt-3 block text-xs text-white/55">
                Підібрати стіл
                <select
                  value={selectedTableId}
                  onChange={(event) => setSelectedTableId(event.target.value)}
                  className="mt-1 w-full rounded-2xl border border-fuchsia-300/45 bg-black px-3 py-3 text-base font-black text-white outline-none shadow-[0_0_18px_rgba(232,121,249,.12)]"
                >
                  <option value="">Оберіть вільний стіл</option>
                  {candidateTables.map((table: TableItem) => (
                    <option key={table.id} value={table.id}>
                      №{table.tableNumber} · {table.zone?.name || 'Без локації'} · {table.seats} місць
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}

          {current.kind === 'review' && (
            <Detail icon={<MessageSquareText size={16} />}>
              {current.text || 'Текст відгуку відсутній'}
            </Detail>
          )}

          {current.kind === 'admin_call' && (
            <Detail icon={<PhoneCall size={16} />}>
              Стіл №{current.booking.table?.tableNumber || '—'} · очікує {Math.max(0, Math.floor((Date.now() - new Date(current.createdAt).getTime()) / 60000))} хв
            </Detail>
          )}

          <div className="mt-4 grid grid-cols-2 gap-2">
            {current.kind === 'booking_created' && (
              <>
                <Action label="ПІДТВЕРДИТИ" disabled={busy} onClick={() => void run(() => bookingsApi.approve(current.booking.id))} tone="emerald" />
                <Action label="ВІДКРИТИ" disabled={busy} onClick={openBookings} />
              </>
            )}
            {(current.kind === 'guest_cancelled' || current.kind === 'guest_reported_lateness') && (
              <>
                <Action label="ЗРОЗУМІЛО" disabled={busy || !current.requestId} onClick={() => void run(() => adminAttentionApi.acknowledge(current.requestId!))} tone="amber" />
                <Action label="ВІДКРИТИ" disabled={busy} onClick={openBookings} />
              </>
            )}
            {current.kind === 'reschedule' && (
              <>
                <Action label="ПІДТВЕРДИТИ" disabled={busy || !current.requestId} onClick={() => void run(() => adminAttentionApi.approveReschedule(current.requestId!))} tone="emerald" />
                <Action label="ВІДХИЛИТИ" disabled={busy || !current.requestId} onClick={() => {
                  const comment = window.prompt('Причина відхилення', '') || undefined;
                  void run(() => adminAttentionApi.rejectReschedule(current.requestId!, comment));
                }} tone="red" />
                <Action label="ВІДКРИТИ БРОНЬ" disabled={busy} onClick={openBookings} wide />
              </>
            )}
            {current.kind === 'table_change' && (
              <>
                <Action label="ПІДТВЕРДИТИ ПЕРЕСАДКУ" disabled={busy || !current.requestId || !selectedTableId} onClick={() => void run(() => adminAttentionApi.approveTableChange(current.requestId!, selectedTableId))} tone="emerald" />
                <Action label="ВІДХИЛИТИ" disabled={busy || !current.requestId} onClick={() => {
                  const comment = window.prompt('Причина відхилення', '') || undefined;
                  void run(() => adminAttentionApi.rejectTableChange(current.requestId!, comment));
                }} tone="red" />
              </>
            )}
            {current.kind === 'review' && (
              <>
                <Action label="ЗРОЗУМІЛО" disabled={busy || !current.requestId} onClick={() => void run(() => adminAttentionApi.acknowledgeReview(current.requestId!))} tone="cyan" />
                <Action label="ДО ГОСТЕЙ" disabled={busy} onClick={() => {
                  const nav = document.querySelector<HTMLElement>('.molo-admin-workspace > main > nav');
                  Array.from(nav?.querySelectorAll<HTMLButtonElement>('button') || []).find((button) => button.textContent?.trim() === 'Гості')?.click();
                }} />
              </>
            )}
            {current.kind === 'admin_call' && current.status !== 'accepted' && (
              <Action label="ПРИЙНЯТИ" disabled={busy || !current.requestId} onClick={() => void run(() => adminAttentionApi.acceptAdminCall(current.requestId!))} tone="rose" wide />
            )}
            {current.kind === 'admin_call' && current.status === 'accepted' && (
              <Action label="ЗАВЕРШИТИ" disabled={busy || !current.requestId} onClick={() => void run(() => adminAttentionApi.completeAdminCall(current.requestId!))} tone="emerald" wide />
            )}
          </div>
        </article>
      )}
      {loading && <p className="mt-2 text-center text-xs text-white/35">Оновлюємо події…</p>}
    </div>,
    target,
  );
}

function Info({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/15 bg-black/45 p-3">
      <p className="flex items-center gap-1 text-[10px] uppercase tracking-[0.13em] text-white/40">{icon}{label}</p>
      <p className="mt-1 truncate font-black">{value}</p>
    </div>
  );
}

function Detail({ children, icon }: { children: React.ReactNode; icon: React.ReactNode }) {
  return (
    <div className="mt-3 flex items-start gap-2 rounded-2xl border border-white/20 bg-black/45 p-3 text-sm leading-5">
      <span className="mt-0.5 shrink-0 text-white/65">{icon}</span>
      <span>{children}</span>
    </div>
  );
}

function Action({
  label,
  disabled,
  onClick,
  tone = 'white',
  wide = false,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  tone?: 'white' | 'emerald' | 'amber' | 'red' | 'cyan' | 'rose';
  wide?: boolean;
}) {
  const classes = {
    white: 'border-white/35 text-white shadow-[0_0_18px_rgba(255,255,255,.08)]',
    emerald: 'border-emerald-300/65 text-emerald-100 shadow-[0_0_22px_rgba(52,211,153,.18)]',
    amber: 'border-amber-200/70 text-amber-100 shadow-[0_0_22px_rgba(251,191,36,.18)]',
    red: 'border-red-300/65 text-red-100 shadow-[0_0_22px_rgba(248,113,113,.16)]',
    cyan: 'border-cyan-200/65 text-cyan-100 shadow-[0_0_22px_rgba(103,232,249,.16)]',
    rose: 'border-rose-300/75 text-rose-100 shadow-[0_0_28px_rgba(251,113,133,.24)]',
  }[tone];
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`${wide ? 'col-span-2' : ''} rounded-2xl border bg-black/65 px-3 py-3 text-sm font-black transition active:scale-[0.98] disabled:opacity-40 ${classes}`}
    >
      {label}
    </button>
  );
}
