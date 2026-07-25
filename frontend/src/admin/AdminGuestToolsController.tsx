import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Ban,
  MessageSquareText,
  Search,
  ShieldCheck,
  UserRound,
  UsersRound,
} from 'lucide-react';

import {
  adminAttentionApi,
  type AdminGuestReview,
} from '../api/adminAttention';
import { clientsApi } from '../api/clients';
import type { Client } from '../api/types';

const POLLING_MS = 15_000;
type View = 'guests' | 'reviews' | 'blacklist';

function formatDateTime(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('uk-UA', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function findGuestsActive() {
  const nav = document.querySelector<HTMLElement>('.molo-admin-workspace > main > nav');
  const button = Array.from(nav?.querySelectorAll<HTMLButtonElement>('button') || [])
    .find((item) => item.textContent?.trim() === 'Гості');
  return Boolean(button?.className.includes('bg-amber-300'));
}

function restoreLegacyGuests() {
  document
    .querySelectorAll<HTMLElement>('[data-molo-legacy-guests-hidden="true"]')
    .forEach((element) => {
      element.style.display = element.dataset.moloPreviousDisplay || '';
      delete element.dataset.moloPreviousDisplay;
      delete element.dataset.moloLegacyGuestsHidden;
    });
}

export default function AdminGuestToolsController() {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [view, setView] = useState<View>('guests');
  const [clients, setClients] = useState<Client[]>([]);
  const [reviews, setReviews] = useState<AdminGuestReview[]>([]);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load(silent = false) {
    try {
      const [nextClients, nextReviews] = await Promise.all([
        clientsApi.getAll(),
        adminAttentionApi.listReviews(),
      ]);
      setClients(nextClients);
      setReviews(nextReviews);
      if (!silent) setError(null);
    } catch (loadError: any) {
      setError(loadError?.message || 'Не вдалося завантажити гостей');
    }
  }

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(true), POLLING_MS);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const sync = () => {
      const main = document.querySelector<HTMLElement>('.molo-admin-workspace > main');
      if (!main || !findGuestsActive()) {
        restoreLegacyGuests();
        setTarget(null);
        return;
      }
      const section = Array.from(main.children).find(
        (child): child is HTMLElement => child instanceof HTMLElement && child.tagName === 'SECTION',
      );
      if (!section) return;

      let mount = section.querySelector<HTMLElement>(':scope > [data-admin-guest-tools-mount]');
      if (!mount) {
        mount = document.createElement('div');
        mount.dataset.adminGuestToolsMount = 'true';
        section.insertBefore(mount, section.children[1] || null);
      }

      Array.from(section.children).forEach((child) => {
        if (!(child instanceof HTMLElement) || child === mount) return;
        if (!child.className.includes('space-y-2')) return;
        if (child.dataset.moloLegacyGuestsHidden === 'true') return;
        child.dataset.moloPreviousDisplay = child.style.display;
        child.dataset.moloLegacyGuestsHidden = 'true';
        child.style.display = 'none';
      });
      setTarget(mount);
    };

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
    });
    return () => {
      observer.disconnect();
      restoreLegacyGuests();
    };
  }, []);

  const visibleClients = useMemo(() => {
    const query = search.trim().toLowerCase();
    return clients.filter((client) => {
      if (view === 'blacklist' && !client.isBlacklisted) return false;
      if (!query) return true;
      return `${client.fullName} ${client.phone} ${client.blacklistReason || ''}`
        .toLowerCase()
        .includes(query);
    });
  }, [clients, search, view]);

  const visibleReviews = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return reviews;
    return reviews.filter((review) =>
      `${review.text} ${review.booking.client?.fullName || ''} ${review.booking.client?.phone || ''}`
        .toLowerCase()
        .includes(query),
    );
  }, [reviews, search]);

  async function blacklist(client: Client) {
    const reason = window.prompt('Причина додавання до чорного списку', client.blacklistReason || '');
    if (reason === null) return;
    setBusy(client.id);
    setError(null);
    setNotice(null);
    try {
      await clientsApi.blacklist(client.id, reason.trim() || undefined);
      setNotice(`${client.fullName} додано до чорного списку`);
      await load(true);
    } catch (actionError: any) {
      setError(actionError?.message || 'Не вдалося додати гостя до чорного списку');
    } finally {
      setBusy(null);
    }
  }

  async function unblacklist(client: Client) {
    if (!window.confirm(`Прибрати ${client.fullName} з чорного списку?`)) return;
    setBusy(client.id);
    setError(null);
    setNotice(null);
    try {
      await clientsApi.unblacklist(client.id);
      setNotice(`${client.fullName} прибрано з чорного списку`);
      await load(true);
    } catch (actionError: any) {
      setError(actionError?.message || 'Не вдалося прибрати гостя з чорного списку');
    } finally {
      setBusy(null);
    }
  }

  if (!target) return null;

  return createPortal(
    <div className="space-y-3" data-admin-guest-tools-root>
      <div className="grid grid-cols-3 gap-2 rounded-[24px] border border-white/15 bg-black/70 p-2 shadow-[0_0_30px_rgba(255,255,255,.05)]">
        <ToolButton active={view === 'guests'} label="Гості" icon={<UsersRound size={17} />} onClick={() => setView('guests')} />
        <ToolButton active={view === 'reviews'} label="Відгуки" icon={<MessageSquareText size={17} />} count={reviews.length} onClick={() => setView('reviews')} />
        <ToolButton active={view === 'blacklist'} label="Чорний список" icon={<Ban size={17} />} count={clients.filter((client) => client.isBlacklisted).length} onClick={() => setView('blacklist')} />
      </div>

      <label className="flex items-center gap-2 rounded-2xl border border-white/20 bg-black/65 px-3 py-3 shadow-[0_0_18px_rgba(255,255,255,.04)]">
        <Search size={17} className="text-white/45" />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={view === 'reviews' ? 'Пошук у відгуках' : 'Ім’я, телефон або причина'}
          className="w-full bg-transparent text-sm text-white outline-none"
        />
      </label>

      {error && <p className="rounded-2xl border border-red-300/50 bg-black/70 px-3 py-2 text-sm text-red-100">{error}</p>}
      {notice && <p className="rounded-2xl border border-emerald-300/45 bg-black/70 px-3 py-2 text-sm text-emerald-100">{notice}</p>}

      {view === 'reviews' ? (
        <div className="space-y-2">
          {visibleReviews.map((review) => (
            <article key={review.id} className="rounded-[22px] border border-cyan-200/35 bg-black/70 p-4 shadow-[0_0_24px_rgba(103,232,249,.08)]">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-black">{review.booking.client?.fullName || 'Гість'}</p>
                  <p className="mt-1 text-xs text-white/45">
                    Стіл №{review.booking.table?.tableNumber || '—'} · {review.booking.bookingDate} · {String(review.booking.bookingTime).slice(0, 5)}
                  </p>
                </div>
                <span className="shrink-0 text-[10px] text-white/35">{formatDateTime(review.createdAt)}</span>
              </div>
              <p className="mt-3 whitespace-pre-wrap rounded-2xl border border-white/15 bg-black/45 p-3 text-sm leading-6 text-white/85">{review.text}</p>
            </article>
          ))}
          {!visibleReviews.length && <Empty text="Відгуків не знайдено." />}
        </div>
      ) : (
        <div className="space-y-2">
          {visibleClients.map((client) => (
            <article key={client.id} className={`rounded-[22px] border bg-black/70 p-3 ${client.isBlacklisted ? 'border-red-300/50 shadow-[0_0_24px_rgba(248,113,113,.12)]' : 'border-white/15'}`}>
              <div className="flex items-start gap-3">
                <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl border ${client.isBlacklisted ? 'border-red-300/55 text-red-100' : 'border-white/20 text-white/65'}`}>
                  {client.isBlacklisted ? <Ban size={19} /> : <UserRound size={19} />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-black">{client.fullName}</p>
                  <p className="mt-1 text-xs text-white/45">{client.phone} · {client.visitsCount} візитів</p>
                  {client.isBlacklisted && (
                    <div className="mt-2 rounded-2xl border border-red-300/25 bg-black/45 p-2 text-xs text-red-100/85">
                      <p>{client.blacklistReason || 'Причину не вказано'}</p>
                      <p className="mt-1 text-red-100/45">З {formatDateTime(client.blacklistedAt)}</p>
                    </div>
                  )}
                </div>
              </div>
              <button
                type="button"
                disabled={busy === client.id}
                onClick={() => void (client.isBlacklisted ? unblacklist(client) : blacklist(client))}
                className={`mt-3 inline-flex w-full items-center justify-center gap-2 rounded-2xl border bg-black/65 px-3 py-3 text-sm font-black transition active:scale-[0.98] disabled:opacity-40 ${client.isBlacklisted ? 'border-emerald-300/55 text-emerald-100 shadow-[0_0_18px_rgba(52,211,153,.12)]' : 'border-red-300/50 text-red-100 shadow-[0_0_18px_rgba(248,113,113,.1)]'}`}
              >
                {client.isBlacklisted ? <ShieldCheck size={17} /> : <Ban size={17} />}
                {client.isBlacklisted ? 'Прибрати з чорного списку' : 'Додати до чорного списку'}
              </button>
            </article>
          ))}
          {!visibleClients.length && <Empty text={view === 'blacklist' ? 'Чорний список порожній.' : 'Гостей не знайдено.'} />}
        </div>
      )}
    </div>,
    target,
  );
}

function ToolButton({ active, label, icon, count, onClick }: { active: boolean; label: string; icon: React.ReactNode; count?: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex min-w-0 flex-col items-center gap-1 rounded-2xl border bg-black/65 px-1 py-2 text-[10px] font-black transition active:scale-[0.98] ${active ? 'border-fuchsia-300/65 text-fuchsia-100 shadow-[0_0_20px_rgba(232,121,249,.16)]' : 'border-white/15 text-white/55'}`}
    >
      {icon}
      <span className="truncate">{label}</span>
      {Boolean(count) && <span className="absolute right-1 top-1 min-w-4 rounded-full border border-red-300/60 bg-black px-1 text-[9px] text-red-100">{count}</span>}
    </button>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-[22px] border border-dashed border-white/15 bg-black/50 p-6 text-center text-sm text-white/45">{text}</div>;
}
