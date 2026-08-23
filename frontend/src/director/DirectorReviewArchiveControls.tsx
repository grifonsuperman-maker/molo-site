import { useMemo, useState } from 'react';
import { Archive, RotateCcw, Search, Trash2, X } from 'lucide-react';

import { reviewsApi, type GuestReviewRecord } from '../api/reviews';

type ReviewView = 'active' | 'archive';
type ChangedHandler = () => void | Promise<void>;

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
  const [archivedReviews, setArchivedReviews] = useState<GuestReviewRecord[]>([]);
  const [query, setQuery] = useState('');
  const [shown, setShown] = useState(20);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<GuestReviewRecord | null>(null);

  const sourceReviews = view === 'active' ? activeReviews : archivedReviews;
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return sourceReviews;
    return sourceReviews.filter((review) => [
      guestName(review),
      review.text,
      review.booking?.bookingDate,
      review.booking?.table?.tableNumber,
    ].filter(Boolean).join(' ').toLowerCase().includes(needle));
  }, [sourceReviews, query]);

  async function loadReviews(showLoading = true) {
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const [active, archive] = await Promise.all([
        reviewsApi.getAll(),
        reviewsApi.getArchive(),
      ]);
      setActiveReviews(active);
      setArchivedReviews(archive);
    } catch (cause: any) {
      setError(cause?.message || 'Не вдалося завантажити відгуки');
    } finally {
      if (showLoading) setLoading(false);
    }
  }

  function openManager() {
    setOpen(true);
    setView('active');
    setQuery('');
    setShown(20);
    void loadReviews();
  }

  function changeView(next: ReviewView) {
    setView(next);
    setQuery('');
    setShown(20);
    setError(null);
  }

  async function archiveReview(review: GuestReviewRecord) {
    setBusy(`archive:${review.id}`);
    setError(null);
    try {
      await reviewsApi.archive(review.id);
      await onChanged();
      await loadReviews(false);
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
      await onChanged();
      await loadReviews(false);
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
    setError(null);
    try {
      await reviewsApi.deletePermanently(review.id);
      setDeleteTarget(null);
      await onChanged();
      await loadReviews(false);
    } catch (cause: any) {
      setError(cause?.message || 'Не вдалося видалити відгук назавжди');
    } finally {
      setBusy(null);
    }
  }

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

      {open && (
        <div
          className="fixed inset-0 z-[95] bg-black/80 p-3 backdrop-blur-xl"
          onMouseDown={() => { if (!busy) setOpen(false); }}
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
                onClick={() => setOpen(false)}
                className="grid h-11 w-11 place-items-center rounded-2xl border border-amber-100/30 bg-black/45 text-amber-100 transition active:scale-95 disabled:opacity-40"
              >
                <X size={18} />
              </button>
            </div>

            <div className="border-b border-white/10 p-4">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => changeView('active')}
                  className={`rounded-2xl border px-3 py-2.5 text-xs font-black ${view === 'active' ? 'border-amber-100/50 bg-black/45 text-amber-100 shadow-[0_0_18px_rgba(251,191,36,.1)]' : 'border-white/10 bg-black/25 text-white/45'}`}
                >
                  Активні · {activeReviews.length}
                </button>
                <button
                  type="button"
                  onClick={() => changeView('archive')}
                  className={`rounded-2xl border px-3 py-2.5 text-xs font-black ${view === 'archive' ? 'border-amber-100/50 bg-black/45 text-amber-100 shadow-[0_0_18px_rgba(251,191,36,.1)]' : 'border-white/10 bg-black/25 text-white/45'}`}
                >
                  Архів · {archivedReviews.length}
                </button>
              </div>
              <label className="relative mt-3 block">
                <Search size={17} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30" />
                <input
                  value={query}
                  onChange={(event) => { setQuery(event.target.value); setShown(20); }}
                  placeholder="Ім’я, текст, дата або стіл"
                  className="h-12 w-full rounded-2xl border border-white/12 bg-black/45 pl-11 pr-4 text-sm outline-none focus:border-amber-100/40"
                />
              </label>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {error && <div className="mb-3 rounded-2xl border border-rose-300/30 bg-black/45 p-3 text-sm text-rose-100">{error}</div>}
              <div className="space-y-2">
                {loading && <div className="rounded-2xl border border-dashed border-white/10 p-5 text-center text-sm text-white/30">Завантаження...</div>}
                {!loading && filtered.slice(0, shown).map((review) => (
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
                          onClick={() => setDeleteTarget(review)}
                          className="inline-flex items-center justify-center gap-2 rounded-2xl border border-rose-200/35 px-3 py-2.5 text-xs font-black text-rose-100 disabled:opacity-35"
                        >
                          <Trash2 size={15} />
                          Видалити назавжди
                        </button>
                      </div>
                    )}
                  </article>
                ))}
                {!loading && !filtered.length && (
                  <div className="rounded-2xl border border-dashed border-white/10 p-5 text-center text-sm text-white/30">
                    {view === 'active' ? 'Активних відгуків немає' : 'Архів відгуків порожній'}
                  </div>
                )}
              </div>
              {!loading && shown < filtered.length && (
                <button
                  type="button"
                  onClick={() => setShown((value) => value + 20)}
                  className="mt-3 w-full rounded-2xl border border-amber-100/35 bg-black/35 px-4 py-3 text-sm font-black text-amber-100"
                >
                  Показати ще · {filtered.length - shown}
                </button>
              )}
            </div>
          </aside>
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-[110] grid place-items-center bg-black/85 p-3 backdrop-blur-xl">
          <div className="w-full max-w-md rounded-[28px] border border-rose-200/30 bg-[#070707] p-5 shadow-[0_0_70px_rgba(244,63,94,.1)]">
            <h2 className="text-xl font-black">Видалити відгук назавжди?</h2>
            <p className="mt-3 text-sm leading-6 text-white/55">
              Відгук гостя «{guestName(deleteTarget)}» буде видалено без можливості відновлення. Бронювання та факт того, що гість уже залишав відгук за цей візит, збережуться.
            </p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={Boolean(busy)}
                onClick={() => setDeleteTarget(null)}
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
        </div>
      )}
    </>
  );
}
