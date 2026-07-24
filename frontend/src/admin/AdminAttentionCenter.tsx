import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  BellRing,
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  MapPin,
  MessageSquareText,
  RefreshCw,
  Table2,
  UserRound,
  UsersRound,
} from 'lucide-react';

import {
  adminAttentionApi,
  type AdminAttentionInbox,
  type AdminAttentionItem,
  type AdminTableOption,
} from '../api/adminAttention';
import { bookingsApi } from '../api/bookings';

const POLLING_MS = 15_000;
const SOUND_REPEAT_MS = 5_000;
const FRESH_MS = 72 * 60 * 60 * 1000;
const ACKNOWLEDGED_KEY = 'molo_admin_attention_acknowledged_v1';
const LEGACY_ACKNOWLEDGED_KEY = 'molo_admin_acknowledged_events_v1';
const SOUND_ENABLED_KEY = 'molo_admin_sound_enabled_v1';

type PortalState = {
  attention: HTMLElement | null;
  reviews: HTMLElement | null;
};

function readSet(key: string) {
  try {
    const value = JSON.parse(window.localStorage.getItem(key) || '[]');
    return new Set(Array.isArray(value) ? value.map(String) : []);
  } catch {
    return new Set<string>();
  }
}

function writeSet(key: string, values: Set<string>) {
  try {
    window.localStorage.setItem(key, JSON.stringify([...values].slice(-500)));
  } catch {}
}

function formatDate(value: string | null | undefined) {
  const [year, month, day] = String(value || '').split('-');
  return year && month && day ? `${day}.${month}.${year}` : value || '—';
}

function formatTime(value: string | null | undefined) {
  const [hours = '00', minutes = '00'] = String(value || '').split(':');
  return `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}`;
}

function itemTitle(item: AdminAttentionItem) {
  if (item.kind === 'reschedule_request') return 'Гість просить змінити час';
  if (item.kind === 'table_change_request') return 'Гість просить змінити стіл';
  if (item.kind === 'admin_call') return 'Гість викликав Адміністратора';
  if (item.kind === 'review') return 'Новий відгук гостя';
  return {
    booking_created: 'Нове бронювання',
    guest_cancelled: 'Бронювання скасовано гостем',
    guest_reported_lateness: 'Гість запізнюється',
    guest_changed_table: 'Стіл гостя змінено',
  }[String(item.action)] || 'Подія бронювання';
}

function accent(item: AdminAttentionItem) {
  if (item.kind === 'admin_call') return 'border-fuchsia-300/70 shadow-[0_0_46px_rgba(217,70,239,.24)]';
  if (item.kind === 'table_change_request') return 'border-violet-300/65 shadow-[0_0_42px_rgba(167,139,250,.2)]';
  if (item.kind === 'reschedule_request') return 'border-amber-200/65 shadow-[0_0_42px_rgba(251,191,36,.2)]';
  if (item.kind === 'review') return 'border-emerald-300/60 shadow-[0_0_42px_rgba(52,211,153,.16)]';
  if (item.action === 'guest_cancelled') return 'border-red-300/65 shadow-[0_0_42px_rgba(248,113,113,.2)]';
  if (item.action === 'guest_reported_lateness') return 'border-amber-200/65 shadow-[0_0_42px_rgba(251,191,36,.2)]';
  return 'border-sky-300/60 shadow-[0_0_42px_rgba(56,189,248,.18)]';
}

function isUrgent(item: AdminAttentionItem, acknowledged: Set<string>) {
  if (!item.booking) return false;
  if (item.kind === 'reschedule_request' || item.kind === 'table_change_request') return true;
  if (item.kind === 'admin_call') return item.status === 'new' || item.status === 'accepted';
  if (item.kind === 'booking_event' && item.action === 'booking_created') {
    return item.booking.status === 'pending';
  }
  const createdAt = new Date(item.createdAt).getTime();
  return Number.isFinite(createdAt) && createdAt >= Date.now() - FRESH_MS && !acknowledged.has(item.id);
}

function findButton(label: string) {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('.molo-admin-workspace nav button'))
    .find((button) => button.textContent?.trim() === label) || null;
}

function useAdminPortals(): PortalState {
  const [portals, setPortals] = useState<PortalState>({ attention: null, reviews: null });

  useEffect(() => {
    let attentionSlot: HTMLElement | null = null;
    let reviewSlot: HTMLElement | null = null;
    let hiddenLegacy: HTMLElement | null = null;

    const sync = () => {
      const main = document.querySelector<HTMLElement>('.molo-admin-workspace > main');
      if (!main) return;

      const sections = Array.from(main.querySelectorAll<HTMLElement>(':scope > section'));
      const home = sections.find((section) =>
        section.textContent?.includes('Найближчі') &&
        (section.textContent?.includes('Потребує уваги') || section.textContent?.includes('Усе спокійно')),
      );

      if (home) {
        const candidate = Array.from(home.children).find((child) =>
          child instanceof HTMLElement &&
          child.dataset.adminAttentionSlot !== 'true' &&
          (child.textContent?.includes('Потребує уваги') || child.textContent?.includes('Усе спокійно')),
        ) as HTMLElement | undefined;

        if (candidate && candidate !== hiddenLegacy) {
          if (hiddenLegacy) hiddenLegacy.style.removeProperty('display');
          hiddenLegacy = candidate;
          hiddenLegacy.dataset.adminLegacyAttentionHidden = 'true';
          hiddenLegacy.style.display = 'none';
        }

        if (!attentionSlot || !attentionSlot.isConnected) {
          attentionSlot = document.createElement('div');
          attentionSlot.dataset.adminAttentionSlot = 'true';
          home.insertBefore(attentionSlot, home.firstChild);
        }
      } else if (attentionSlot?.isConnected) {
        attentionSlot.remove();
        attentionSlot = null;
      }

      const guestInput = main.querySelector<HTMLInputElement>('input[placeholder="Ім’я або телефон"]');
      const guests = guestInput?.closest('section') as HTMLElement | null;
      if (guests) {
        if (!reviewSlot || !reviewSlot.isConnected) {
          reviewSlot = document.createElement('div');
          reviewSlot.dataset.adminReviewsSlot = 'true';
          const toolbar = guestInput?.closest('div.rounded-\\[24px\\]') || guests.firstElementChild;
          if (toolbar?.nextSibling) guests.insertBefore(reviewSlot, toolbar.nextSibling);
          else guests.appendChild(reviewSlot);
        }
      } else if (reviewSlot?.isConnected) {
        reviewSlot.remove();
        reviewSlot = null;
      }

      setPortals((current) => {
        if (current.attention === attentionSlot && current.reviews === reviewSlot) return current;
        return { attention: attentionSlot, reviews: reviewSlot };
      });
    };

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      if (hiddenLegacy) hiddenLegacy.style.removeProperty('display');
      attentionSlot?.remove();
      reviewSlot?.remove();
    };
  }, []);

  return portals;
}

export default function AdminAttentionCenter() {
  const portals = useAdminPortals();
  const [inbox, setInbox] = useState<AdminAttentionInbox>({ items: [], reviews: [] });
  const [acknowledged, setAcknowledged] = useState<Set<string>>(() => readSet(ACKNOWLEDGED_KEY));
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tableOptions, setTableOptions] = useState<AdminTableOption[]>([]);
  const [tableRequestId, setTableRequestId] = useState<string | null>(null);
  const [selectedTableId, setSelectedTableId] = useState('');
  const [soundEnabled, setSoundEnabled] = useState(() => {
    try {
      return window.localStorage.getItem(SOUND_ENABLED_KEY) !== 'false';
    } catch {
      return true;
    }
  });
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);

  const load = async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      setInbox(await adminAttentionApi.inbox(200));
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Не вдалося оновити події');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(true), POLLING_MS);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const unlock = () => setAudioUnlocked(true);
    window.addEventListener('pointerdown', unlock, { once: true });
    return () => window.removeEventListener('pointerdown', unlock);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      try {
        setSoundEnabled(window.localStorage.getItem(SOUND_ENABLED_KEY) !== 'false');
      } catch {}
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const urgentItems = useMemo(
    () => inbox.items.filter((item) => isUrgent(item, acknowledged)),
    [inbox.items, acknowledged],
  );

  useEffect(() => {
    if (index >= urgentItems.length) setIndex(0);
  }, [index, urgentItems.length]);

  const newOnlySoundNeeded = useMemo(
    () => urgentItems.some((item) => item.kind !== 'booking_event') &&
      !urgentItems.some((item) => item.kind === 'booking_event'),
    [urgentItems],
  );

  const playSound = () => {
    if (!newOnlySoundNeeded || !soundEnabled || !audioUnlocked) return;
    try {
      const AudioContextClass = window.AudioContext ||
        (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;
      const context = audioContextRef.current || new AudioContextClass();
      audioContextRef.current = context;
      if (context.state === 'suspended') void context.resume();
      const now = context.currentTime;
      [660, 880, 1040].forEach((frequency, note) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.value = frequency;
        const start = now + note * 0.13;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.28, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.2);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(start);
        oscillator.stop(start + 0.22);
      });
    } catch {}
  };

  useEffect(() => {
    if (!newOnlySoundNeeded || !soundEnabled || !audioUnlocked) return;
    playSound();
    const timer = window.setInterval(playSound, SOUND_REPEAT_MS);
    return () => window.clearInterval(timer);
  }, [newOnlySoundNeeded, soundEnabled, audioUnlocked, urgentItems.map((item) => item.id).join('|')]);

  const current = urgentItems[index] || null;

  const acknowledge = (item: AdminAttentionItem) => {
    if (item.kind === 'booking_event') {
      const legacy = readSet(LEGACY_ACKNOWLEDGED_KEY);
      legacy.add(item.sourceId);
      writeSet(LEGACY_ACKNOWLEDGED_KEY, legacy);
      window.setTimeout(() => window.location.reload(), 60);
      return;
    }
    setAcknowledged((currentSet) => {
      const next = new Set(currentSet);
      next.add(item.id);
      writeSet(ACKNOWLEDGED_KEY, next);
      return next;
    });
  };

  const run = async (key: string, action: () => Promise<{ message: string }>) => {
    try {
      setBusy(key);
      setError(null);
      const result = await action();
      setNotice(result.message || 'Дію виконано');
      setSelectedTableId('');
      setTableOptions([]);
      setTableRequestId(null);
      await load(true);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Не вдалося виконати дію');
    } finally {
      setBusy(null);
    }
  };

  const openBooking = (item: AdminAttentionItem) => {
    findButton('Броні')?.click();
    window.setTimeout(() => {
      const cards = Array.from(document.querySelectorAll<HTMLElement>('.molo-admin-workspace article'));
      const tableNumber = String(item.booking.table?.tableNumber || '');
      cards.find((card) => tableNumber && card.textContent?.includes(`№${tableNumber}`))?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
  };

  const openReviews = () => {
    findButton('Гості')?.click();
    window.setTimeout(() => document.querySelector('[data-admin-reviews-slot]')?.scrollIntoView({ behavior: 'smooth' }), 100);
  };

  const loadTableOptions = async (item: AdminAttentionItem) => {
    try {
      setBusy(`options:${item.sourceId}`);
      setError(null);
      const options = await adminAttentionApi.tableOptions(item.sourceId);
      setTableOptions(options);
      setTableRequestId(item.sourceId);
      setSelectedTableId('');
      if (!options.length) setNotice('Відповідних вільних столів зараз немає');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Не вдалося підібрати столи');
    } finally {
      setBusy(null);
    }
  };

  const attentionPortal = portals.attention ? createPortal(
    <div className="space-y-3">
      {(notice || error) && (
        <div className={`rounded-2xl border px-3 py-2 text-sm ${error ? 'border-red-300/35 text-red-100' : 'border-emerald-300/35 text-emerald-100'}`}>
          {error || notice}
        </div>
      )}
      {current ? (
        <article className={`animate-pulse rounded-[28px] border bg-black/55 p-4 backdrop-blur-xl ${accent(current)}`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em]"><BellRing size={16} />Потребує уваги</p>
              <h2 className="mt-2 text-xl font-black">{itemTitle(current)}</h2>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => void load()} disabled={loading} className="rounded-xl border border-white/20 p-2"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></button>
              {urgentItems.length > 1 && (
                <div className="flex items-center gap-1 rounded-xl border border-white/15 p-1">
                  <button type="button" onClick={() => setIndex((value) => (value - 1 + urgentItems.length) % urgentItems.length)} className="p-1"><ChevronLeft size={17} /></button>
                  <span className="px-1 text-xs">{index + 1}/{urgentItems.length}</span>
                  <button type="button" onClick={() => setIndex((value) => (value + 1) % urgentItems.length)} className="p-1"><ChevronRight size={17} /></button>
                </div>
              )}
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <Info icon={<Table2 size={15} />} label="Стіл" value={`№${current.booking.table?.tableNumber || '—'}`} />
            <Info icon={<UserRound size={15} />} label="Гість" value={current.booking.client?.fullName || '—'} />
            <Info icon={<CalendarClock size={15} />} label="Дата і час" value={`${formatDate(current.booking.bookingDate)} · ${formatTime(current.booking.bookingTime)}`} />
            <Info icon={<UsersRound size={15} />} label="Гостей" value={String(current.booking.guestsCount || 0)} />
          </div>

          {current.kind === 'reschedule_request' && (
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <Info icon={<Clock3 size={15} />} label="Було" value={`${formatDate(current.booking.bookingDate)} · ${formatTime(current.booking.bookingTime)}`} />
              <Info icon={<Clock3 size={15} />} label="Запит" value={`${formatDate(current.requestedDate)} · ${formatTime(current.requestedTime)}`} />
            </div>
          )}

          {current.kind === 'table_change_request' && (
            <div className="mt-3 rounded-2xl border border-violet-300/25 bg-black/25 p-3 text-sm">
              Бажання гостя: {current.requestedTableNumber ? `стіл №${current.requestedTableNumber}` : 'підібрати інший стіл'}
            </div>
          )}

          {current.kind === 'admin_call' && (
            <div className="mt-3 rounded-2xl border border-fuchsia-300/25 bg-black/25 p-3 text-sm">
              Очікує {Math.max(0, Math.floor((Date.now() - new Date(current.createdAt).getTime()) / 60000))} хв · {current.status === 'accepted' ? 'прийнято' : 'новий виклик'}
            </div>
          )}

          {current.kind === 'review' && (
            <blockquote className="mt-3 rounded-2xl border border-emerald-300/25 bg-black/25 p-3 text-sm leading-6">“{current.text}”</blockquote>
          )}

          {current.kind === 'booking_event' && current.action === 'guest_reported_lateness' && (
            <div className="mt-3 rounded-2xl border border-amber-200/25 bg-black/25 p-3 text-sm">
              Запізнення: {Number(current.booking.latenessHours || 0) * 60 + Number(current.booking.latenessMinutes || 0)} хв
            </div>
          )}

          {current.kind === 'table_change_request' && tableRequestId === current.sourceId && (
            <div className="mt-3 rounded-2xl border border-violet-300/25 bg-black/30 p-3">
              <label className="text-xs uppercase tracking-[.14em] text-white/45">Вільний відповідний стіл
                <select value={selectedTableId} onChange={(event) => setSelectedTableId(event.target.value)} className="mt-2 w-full rounded-xl border border-white/15 bg-neutral-950 px-3 py-3 text-sm font-bold text-white outline-none">
                  <option value="">Оберіть стіл</option>
                  {tableOptions.map((table) => <option key={table.id} value={table.id}>№{table.tableNumber} · {table.zoneName} · {table.seats} місць</option>)}
                </select>
              </label>
              <button type="button" disabled={!selectedTableId || Boolean(busy)} onClick={() => void run(`table-approve:${current.sourceId}`, () => adminAttentionApi.approveTableChange(current.sourceId, selectedTableId))} className="mt-2 w-full rounded-xl border border-emerald-300/55 px-3 py-3 text-sm font-black text-emerald-100 disabled:opacity-40">Підтвердити пересадку</button>
            </div>
          )}

          <div className="mt-4 grid grid-cols-2 gap-2">
            {current.kind === 'booking_event' && current.action === 'booking_created' && (
              <>
                <OutlineButton tone="emerald" disabled={Boolean(busy)} onClick={() => void run(`booking:${current.booking.id}`, () => bookingsApi.approve(current.booking.id))}>Підтвердити</OutlineButton>
                <OutlineButton onClick={() => openBooking(current)}>Відкрити</OutlineButton>
              </>
            )}
            {current.kind === 'booking_event' && current.action !== 'booking_created' && (
              <>
                <OutlineButton tone="amber" onClick={() => acknowledge(current)}>Зрозуміло</OutlineButton>
                <OutlineButton onClick={() => openBooking(current)}>Відкрити</OutlineButton>
              </>
            )}
            {current.kind === 'reschedule_request' && (
              <>
                <OutlineButton tone="emerald" disabled={Boolean(busy)} onClick={() => void run(`time-approve:${current.sourceId}`, () => adminAttentionApi.approveReschedule(current.sourceId))}>Підтвердити</OutlineButton>
                <OutlineButton tone="red" disabled={Boolean(busy)} onClick={() => {
                  const reason = window.prompt('Причина відмови', 'Запропонований час недоступний');
                  if (reason !== null) void run(`time-reject:${current.sourceId}`, () => adminAttentionApi.rejectReschedule(current.sourceId, reason));
                }}>Відхилити</OutlineButton>
                <OutlineButton onClick={() => openBooking(current)}>Відкрити бронь</OutlineButton>
              </>
            )}
            {current.kind === 'table_change_request' && (
              <>
                <OutlineButton tone="violet" disabled={Boolean(busy)} onClick={() => void loadTableOptions(current)}>Підібрати стіл</OutlineButton>
                <OutlineButton tone="red" disabled={Boolean(busy)} onClick={() => {
                  const reason = window.prompt('Причина відмови', 'Зараз немає відповідного вільного столу');
                  if (reason !== null) void run(`table-reject:${current.sourceId}`, () => adminAttentionApi.rejectTableChange(current.sourceId, reason));
                }}>Відхилити</OutlineButton>
                <OutlineButton onClick={() => openBooking(current)}>Відкрити бронь</OutlineButton>
              </>
            )}
            {current.kind === 'admin_call' && current.status === 'new' && (
              <>
                <OutlineButton tone="fuchsia" disabled={Boolean(busy)} onClick={() => void run(`call-accept:${current.sourceId}`, () => adminAttentionApi.acceptAdminCall(current.sourceId))}>Прийняти</OutlineButton>
                <OutlineButton onClick={() => openBooking(current)}>Відкрити</OutlineButton>
              </>
            )}
            {current.kind === 'admin_call' && current.status === 'accepted' && (
              <>
                <OutlineButton tone="emerald" disabled={Boolean(busy)} onClick={() => void run(`call-complete:${current.sourceId}`, () => adminAttentionApi.completeAdminCall(current.sourceId))}>Завершити</OutlineButton>
                <OutlineButton onClick={() => openBooking(current)}>Відкрити</OutlineButton>
              </>
            )}
            {current.kind === 'review' && (
              <>
                <OutlineButton tone="emerald" onClick={() => acknowledge(current)}>Прочитано</OutlineButton>
                <OutlineButton onClick={openReviews}>Усі відгуки</OutlineButton>
              </>
            )}
          </div>
        </article>
      ) : (
        <div className="rounded-[26px] border border-emerald-300/25 bg-black/45 p-5 shadow-[0_0_30px_rgba(52,211,153,.08)]">
          <div className="flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-2xl border border-emerald-300/35 text-emerald-200"><Check size={22} /></span><div><p className="font-black">Усе спокійно</p><p className="text-sm text-white/45">Подій, що потребують реакції, немає.</p></div></div>
        </div>
      )}
    </div>,
    portals.attention,
  ) : null;

  const reviewsPortal = portals.reviews ? createPortal(
    <section className="rounded-[26px] border border-emerald-300/25 bg-black/55 p-4 shadow-[0_0_34px_rgba(52,211,153,.08)] backdrop-blur-xl">
      <div className="flex items-center justify-between gap-3">
        <div><p className="flex items-center gap-2 font-black"><MessageSquareText size={18} />Відгуки гостей</p><p className="mt-1 text-xs text-white/45">Внутрішні відгуки MOLO · {inbox.reviews.length}</p></div>
        <button type="button" onClick={() => void load()} disabled={loading} className="rounded-xl border border-white/15 p-2"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></button>
      </div>
      <div className="mt-3 space-y-2">
        {inbox.reviews.map((review) => (
          <article key={review.id} className="rounded-2xl border border-white/10 bg-black/30 p-3">
            <div className="flex items-start justify-between gap-3"><div><p className="font-bold">{review.booking.client?.fullName || 'Гість'} · Стіл №{review.booking.table?.tableNumber || '—'}</p><p className="text-xs text-white/40">{formatDate(review.booking.bookingDate)} · {formatTime(review.booking.bookingTime)}</p></div><MapPin size={16} className="text-emerald-200/70" /></div>
            <p className="mt-2 text-sm leading-6 text-white/75">{review.text}</p>
          </article>
        ))}
        {!inbox.reviews.length && <p className="rounded-2xl border border-dashed border-white/10 p-5 text-center text-sm text-white/40">Відгуків ще немає.</p>}
      </div>
    </section>,
    portals.reviews,
  ) : null;

  return <>{attentionPortal}{reviewsPortal}</>;
}

function Info({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return <div className="rounded-2xl border border-white/10 bg-black/25 p-3"><p className="flex items-center gap-1.5 text-[10px] uppercase tracking-[.13em] text-white/35">{icon}{label}</p><p className="mt-1 truncate font-bold">{value}</p></div>;
}

function OutlineButton({ children, tone = 'white', disabled = false, onClick }: {
  children: ReactNode;
  tone?: 'white' | 'emerald' | 'amber' | 'red' | 'violet' | 'fuchsia';
  disabled?: boolean;
  onClick: () => void;
}) {
  const classes = {
    white: 'border-white/25 text-white',
    emerald: 'border-emerald-300/55 text-emerald-100 shadow-[0_0_16px_rgba(52,211,153,.12)]',
    amber: 'border-amber-200/55 text-amber-100 shadow-[0_0_16px_rgba(251,191,36,.12)]',
    red: 'border-red-300/50 text-red-100 shadow-[0_0_16px_rgba(248,113,113,.1)]',
    violet: 'border-violet-300/55 text-violet-100 shadow-[0_0_16px_rgba(167,139,250,.12)]',
    fuchsia: 'border-fuchsia-300/55 text-fuchsia-100 shadow-[0_0_16px_rgba(217,70,239,.14)]',
  }[tone];
  return <button type="button" disabled={disabled} onClick={onClick} className={`rounded-2xl border bg-black/20 px-4 py-3 font-black transition active:scale-[.98] disabled:opacity-40 ${classes}`}>{children}</button>;
}
