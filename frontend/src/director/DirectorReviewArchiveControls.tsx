import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Archive, RotateCcw, Search, Trash2, X } from 'lucide-react';

import { reviewsApi, type GuestReviewRecord } from '../api/reviews';

type ReviewView = 'active' | 'archive';
type ChangedHandler = () => void | Promise<void>;

const REVIEW_PAGE_SIZE = 50;

function dateLabel(value?: string | null): string {
  if (!value) return '-';
  const [year, month, day] = String(value).slice(0, 10).split('-');
  return year && month && day ? `${day}.${month}.${year}` : String(value);
}

function guestName(review: GuestReviewRecord): string {
  return review.booking?.client?.fullName || 'Гість';
}

export function ReviewArchiveButton({ onChanged }: { onChanged: ChangedHandler }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<ReviewView>('active');
  const [activeReviews, setActiveReviews] = useState<GuestReviewRecord[]>([]);
  const [activeTotal, setActiveTotal] = useState<number | null>(null);
  const [activeResultTotal, setActiveResultTotal] = useState(0);
  const [activePage, setActivePage] = useState(0);
  const [activeHasMore, setActiveHasMore] = useState(false);
  const [activeRefreshRetry, setActiveRefreshRetry] = useState(false);
  const [archivedReviews, setArchivedReviews] = useState<GuestReviewRecord[]>([]);
  const [archiveTotal, setArchiveTotal] = useState<number | null>(null);
  const [archiveResultTotal, setArchiveResultTotal] = useState(0);
  const [archivePage, setArchivePage] = useState(0);
  const [archiveHasMore, setArchiveHasMore] = useState(false);
  const [archiveRefreshRetry, setArchiveRefreshRetry] = useState(false);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<GuestReviewRecord | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const activeRequestId = useRef(0);
  const archiveRequestId = useRef(0);

  const visibleReviews = view === 'active' ? activeReviews : archivedReviews;

  async function loadActivePage(
    page: number,
    search: string,
    append: boolean,
    showLoading = true,
  ) {
    const requestId = ++activeRequestId.current;
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const result = await reviewsApi.getActive({
        page,
        limit: REVIEW_PAGE_SIZE,
        query: search,
      });
      if (requestId !== activeRequestId.current) return;

      setActiveReviews((current) => {
        if (!append) return result.items;
        const existing = new Set(current.map((review) => review.id));
        return [...current, ...result.items.filter((review) => !existing.has(review.id))];
      });
      if (!search.trim()) setActiveTotal(result.total);
      setActiveResultTotal(result.total);
      setActivePage(result.page);
      setActiveHasMore(result.hasMore);
      setActiveRefreshRetry(false);
    } catch (cause: any) {
      if (requestId === activeRequestId.current) {
        if (!append) {
          if (showLoading) {
            setActiveReviews([]);
            setActiveResultTotal(0);
          }
          setActivePage(0);
          setActiveHasMore(false);
          setActiveRefreshRetry(!showLoading);
        }
        setError(cause?.message || 'Не вдалося завантажити активні відгуки');
      }
    } finally {
      if (showLoading && requestId === activeRequestId.current) setLoading(false);
    }
  }

  async function loadArchivePage(
    page: number,
    search: string,
    append: boolean,
    showLoading = true,
  ) {
    const requestId = ++archiveRequestId.current;
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const result = await reviewsApi.getArchive({
        page,
        limit: REVIEW_PAGE_SIZE,
        query: search,
      });
      if (requestId !== archiveRequestId.current) return;

      setArchivedReviews((current) => {
        if (!append) return result.items;
        const existing = new Set(current.map((review) => review.id));
        return [...current, ...result.items.filter((review) => !existing.has(review.id))];
      });
      if (!search.trim()) setArchiveTotal(result.total);
      setArchiveResultTotal(result.total);
      setArchivePage(result.page);
      setArchiveHasMore(result.hasMore);
      setArchiveRefreshRetry(false);
    } catch (cause: any) {
      if (requestId === archiveRequestId.current) {
        if (!append) {
          if (showLoading) {
            setArchivedReviews([]);
            setArchiveResultTotal(0);
          }
          setArchivePage(0);
          setArchiveHasMore(false);
          setArchiveRefreshRetry(!showLoading);
        }
        setError(cause?.message || 'Не вдалося завантажити архів відгуків');
      }
    } finally {
      if (showLoading && requestId === archiveRequestId.current) setLoading(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    const timeout = window.setTimeout(() => {
      if (view === 'active') {
        void loadActivePage(1, query, false);
      } else {
        void loadArchivePage(1, query, false);
      }
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [open, view, query]);

  function invalidateRequests() {
    activeRequestId.current += 1;
    archiveRequestId.current += 1;
    setLoading(false);
  }

  function openManager() {
    invalidateRequests();
    setLoading(true);
    setOpen(true);
    setView('active');
    setQuery('');
    setActiveReviews([]);
    setActiveTotal(null);
    setActiveResultTotal(0);
    setActivePage(0);
    setActiveHasMore(false);
    setActiveRefreshRetry(false);
    setArchivedReviews([]);
    setArchiveTotal(null);
    setArchiveResultTotal(0);
    setArchivePage(0);
    setArchiveHasMore(false);
    setArchiveRefreshRetry(false);
    setDeleteTarget(null);
    setDeleteError(null);
    setError(null);
  }

  function closeManager() {
    if (busy) return;
    invalidateRequests();
    setOpen(false);
  }

  function changeView(next: ReviewView) {
    if (busy || next === view) return;
    invalidateRequests();
    setLoading(true);
    setView(next);
    setQuery('');
    setError(null);
  }

  function changeQuery(next: string) {
    if (busy) return;
    invalidateRequests();
    setLoading(true);
    setQuery(next);
    setError(null);
  }

  function requestPermanentDelete(review: GuestReviewRecord) {
    setDeleteTarget(review);
    setDeleteError(null);
  }

  function cancelPermanentDelete() {
    setDeleteTarget(null);
    setDeleteError(null);
  }

  async function archiveReview(review: GuestReviewRecord) {
    setBusy(`archive:${review.id}`);
    setError(null);
    try {
      await reviewsApi.archive(review.id);
      setActiveReviews((current) => current.filter((item) => item.id !== review.id));
      setActiveResultTotal((current) => Math.max(0, current - 1));
      setActiveTotal((current) => current === null ? null : Math.max(0, current - 1));
      setArchiveTotal((current) => current === null ? null : current + 1);
      await onChanged();
      await loadActivePage(1, query, false, false);
    } catch (cause: any) {
      setError(cause?.message || 'Не вдалося архівувати відгук');
    } finally {
      setBusy(null);
    }
  }

  async function restoreReview(review: GuestReviewRecord) {
    setBusy(`restore:${review.id}`);
    setError(null);
    try {
      await reviewsApi.restore(review.id);
      setArchivedReviews((current) => current.filter((item) => item.id !== review.id));
      setArchiveResultTotal((current) => Math.max(0, current - 1));
      setActiveTotal((current) => current === null ? null : current + 1);
      setArchiveTotal((current) => current === null ? null : Math.max(0, current - 1));
      await onChanged();
      await loadArchivePage(1, query, false, false);
    } catch (cause: any) {
      setError(cause?.message || 'Не вдалося відновити відгук');
    } finally {
      setBusy(null);
    }
  }

  async function deleteReviewPermanently() {
    if (!deleteTarget) return;
    const review = deleteTarget;
    setBusy(`delete:${review.id}`);
    setDeleteError(null);
    try {
      await reviewsApi.deletePermanently(review.id);
      setArchivedReviews((current) => current.filter((item) => item.id !== review.id));
      setArchiveResultTotal((current) => Math.max(0, current - 1));
      setArchiveTotal((current) => current === null ? null : Math.max(0, current - 1));
      setDeleteTarget(null);
      await onChanged();
      await loadArchivePage(1, query, false, false);
    } catch (cause: any) {
      setDeleteError(cause?.message || 'Не вдалося видалити відгук назавжди');
    } finally {
      setBusy(null);
    }
  }

  async function retryActiveRefresh() {
    if (busy) return;
    setBusy('active-retry');
    try {
      await loadActivePage(1, query, false, false);
    } finally {
      setBusy(null);
    }
  }

  async function retryArchiveRefresh() {
    if (busy) return;
    setBusy('archive-retry');
    try {
      await loadArchivePage(1, query, false, false);
    } finally {
      setBusy(null);
    }
  }

  async function loadMoreActive() {
    if (!activeHasMore || busy) return;
    setBusy('active-page');
    try {
      await loadActivePage(activePage + 1, query, true, false);
    } finally {
      setBusy(null);
    }
  }

  async function loadMoreArchive() {
    if (!archiveHasMore || busy) return;
    setBusy('archive-page');
    try {
      await loadArchivePage(archivePage + 1, query, true, false);
    } finally {
      setBusy(null);
    }
  }

  const managerDialog = open ? createPortal(
    <div
      className="fixed inset-0 z-[95] bg-black/80 p-3 backdrop-blur-xl"
      onMouseDown={closeManager}
    >
      <aside
        className="ml-auto flex h-full w-full max-w-2xl flex-col overflow-hidden rounded-[28px] border border-amber-100/20 bg-[#050505]/95 shadow-[0_0_70px_rgba(251,191,36,.08)]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/10 p-4">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-amber-100/45">Письмові відгуки</p>
            <h2 className="mt-1 text-2xl font-black">Керування відгуками</h2>
          </div>
          <button
            type="button"
            aria-label="Закрити"
            disabled={Boolean(busy)}
            onClick={closeManager}
            className="grid h-11 w-11 place-items-center rounded-2xl border border-amber-100/30 bg-black/45 text-amber-100 transition active:scale-95 disabled:opacity-40"
          >
            <X size={18} />
          </button>
        </div>

        <div className="border-b border-white/10 p-4">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() => changeView('active')}
              className={`rounded-2xl border px-3 py-2.5 text-xs font-black disabled:opacity-35 ${view === 'active' ? 'border-amber-100/50 bg-black/45 text-amber-100 shadow-[0_0_18px_rgba(251,191,36,.1)]' : 'border-white/10 bg-black/25 text-white/45'}`}
            >
              Активні{activeTotal === null ? '' : ` · ${activeTotal}`}
            </button>
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() => changeView('archive')}
              className={`rounded-2xl border px-3 py-2.5 text-xs font-black disabled:opacity-35 ${view === 'archive' ? 'border-amber-100/50 bg-black/45 text-amber-100 shadow-[0_0_18px_rgba(251,191,36,.1)]' : 'border-white/10 bg-black/25 text-white/45'}`}
            >
              Архів{archiveTotal === null ? '' : ` · ${archiveTotal}`}
            </button>
          </div>
          <label className="relative mt-3 block">
            <Search size={17} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30" />
            <input
              value={query}
              disabled={Boolean(busy)}
              onChange={(event) => changeQuery(event.target.value)}
              placeholder="Ім’я, текст, дата або стіл"
              className="h-12 w-full rounded-2xl border border-white/12 bg-black/45 pl-11 pr-4 text-sm outline-none focus:border-amber-100/40 disabled:opacity-50"
            />
          </label>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {error && <div className="mb-3 rounded-2xl border border-rose-300/30 bg-black/45 p-3 text-sm text-rose-100">{error}</div>}
          <div className="space-y-2">
            {loading && <div className="rounded-2xl border border-dashed border-white/10 p-5 text-center text-sm text-white/30">Завантаження...</div>}
            {!loading && visibleReviews.map((review) => (
              <article key={review.id} className="rounded-2xl border border-white/10 bg-black/35 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-black">{guestName(review)}</p>
                    <p className="mt-1 text-xs text-white/40">
                      {dateLabel(review.booking?.bookingDate)} · Стіл №{review.booking?.table?.tableNumber || '-'}
                    </p>
                  </div>
                  <Archive size={18} className={view === 'archive' ? 'text-amber-100/60' : 'text-white/25'} />
                </div>
                <p className="mt-3 whitespace-pre-wrap text-sm text-white/70">{review.text}</p>
                {review.responseText && (
                  <div className="mt-3 rounded-2xl border border-emerald-200/20 bg-black/30 p-3">
                    <p className="text-[10px] font-black uppercase tracking-[0.22em] text-emerald-100/50">Відповідь</p>
                    <p className="mt-2 whitespace-pre-wrap text-sm text-emerald-50">{review.responseText}</p>
                  </div>
                )}

                {view === 'active' ? (
                  <button
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() => void archiveReview(review)}
                    className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-amber-100/35 px-3 py-2.5 text-xs font-black text-amber-100 disabled:opacity-35"
                  >
                    <Archive size={15} />
                    {busy === `archive:${review.id}` ? 'Архівуємо...' : 'Архівувати'}
                  </button>
                ) : (
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      disabled={Boolean(busy)}
                      onClick={() => void restoreReview(review)}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl border border-emerald-200/35 px-3 py-2.5 text-xs font-black text-emerald-100 disabled:opacity-35"
                    >
                      <RotateCcw size={15} />
                      {busy === `restore:${review.id}` ? 'Відновлюємо...' : 'Відновити'}
                    </button>
                    <button
                      type="button"
                      disabled={Boolean(busy)}
                      onClick={() => requestPermanentDelete(review)}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl border border-rose-200/35 px-3 py-2.5 text-xs font-black text-rose-100 disabled:opacity-35"
                    >
                      <Trash2 size={15} />
                      Видалити назавжди
                    </button>
                  </div>
                )}
              </article>
            ))}
            {!loading && !visibleReviews.length && (
              <div className="rounded-2xl border border-dashed border-white/10 p-5 text-center text-sm text-white/30">
                {view === 'active' ? 'Активних відгуків немає' : 'Архів відгуків порожній'}
              </div>
            )}
          </div>
          {!loading && view === 'active' && activeRefreshRetry && (
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() => void retryActiveRefresh()}
              className="mt-3 w-full rounded-2xl border border-amber-100/35 bg-black/35 px-4 py-3 text-sm font-black text-amber-100 disabled:opacity-35"
            >
              {busy === 'active-retry' ? 'Оновлюємо...' : 'Спробувати ще'}
            </button>
          )}
          {!loading && view === 'active' && !activeRefreshRetry && activeHasMore && (
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() => void loadMoreActive()}
              className="mt-3 w-full rounded-2xl border border-amber-100/35 bg-black/35 px-4 py-3 text-sm font-black text-amber-100 disabled:opacity-35"
            >
              {busy === 'active-page'
                ? 'Завантажуємо...'
                : `Показати ще · ${Math.max(0, activeResultTotal - activeReviews.length)}`}
            </button>
          )}
          {!loading && view === 'archive' && archiveRefreshRetry && (
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() => void retryArchiveRefresh()}
              className="mt-3 w-full rounded-2xl border border-amber-100/35 bg-black/35 px-4 py-3 text-sm font-black text-amber-100 disabled:opacity-35"
            >
              {busy === 'archive-retry' ? 'Оновлюємо...' : 'Спробувати ще'}
            </button>
          )}
          {!loading && view === 'archive' && !archiveRefreshRetry && archiveHasMore && (
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() => void loadMoreArchive()}
              className="mt-3 w-full rounded-2xl border border-amber-100/35 bg-black/35 px-4 py-3 text-sm font-black text-amber-100 disabled:opacity-35"
            >
              {busy === 'archive-page'
                ? 'Завантажуємо...'
                : `Показати ще · ${Math.max(0, archiveResultTotal - archivedReviews.length)}`}
            </button>
          )}
        </div>
      </aside>
    </div>,
    document.body,
  ) : null;

  const deleteDialog = deleteTarget ? createPortal(
    <div className="fixed inset-0 z-[110] grid place-items-center bg-black/85 p-3 backdrop-blur-xl">
      <div className="w-full max-w-md rounded-[28px] border border-rose-200/30 bg-[#070707] p-5 shadow-[0_0_70px_rgba(244,63,94,.1)]">
        <h2 className="text-xl font-black">Видалити відгук назавжди?</h2>
        <p className="mt-3 text-sm leading-6 text-white/55">
          Відгук гостя «{guestName(deleteTarget)}» буде видалено без можливості відновлення. Бронювання та факт того, що гість уже залишав відгук за цей візит, збережуться.
        </p>
        {deleteError && (
          <div className="mt-3 rounded-2xl border border-rose-300/35 bg-black/45 p-3 text-sm text-rose-100">
            {deleteError}
          </div>
        )}
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={cancelPermanentDelete}
            className="rounded-2xl border border-amber-100/35 bg-black/35 px-4 py-3 text-sm font-black text-amber-100 disabled:opacity-35"
          >
            Скасувати
          </button>
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() => void deleteReviewPermanently()}
            className="rounded-2xl border border-rose-200/40 bg-black/35 px-4 py-3 text-sm font-black text-rose-100 disabled:opacity-35"
          >
            {busy === `delete:${deleteTarget.id}` ? 'Видаляємо...' : 'Видалити назавжди'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  ) : null;

  return (
    <>
      <button
        type="button"
        onClick={openManager}
        className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-amber-100/35 bg-black/35 px-4 py-3 text-sm font-black text-amber-100 transition hover:bg-white/[0.025] active:scale-[.985]"
      >
        <Archive size={16} />
        Керувати відгуками
      </button>
      {managerDialog}
      {deleteDialog}
    </>
  );
}