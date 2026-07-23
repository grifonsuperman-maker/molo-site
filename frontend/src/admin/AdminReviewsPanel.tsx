import { useEffect, useState } from 'react';
import { MessageSquareText, RefreshCw } from 'lucide-react';

import { restaurantApi } from '../api/restaurant';
import { reviewsApi } from '../api/reviews';
import type { GuestReviewRecord } from '../api/reviews';

function dateLabel(value: string | null | undefined) {
  if (!value) return '-';
  const [year, month, day] = String(value).slice(0, 10).split('-');
  return year && month && day ? `${day}.${month}.${year}` : String(value);
}

export default function AdminReviewsPanel() {
  const [reviews, setReviews] = useState<GuestReviewRecord[]>([]);
  const [canRespond, setCanRespond] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    const [reviewsResult, restaurantResult] = await Promise.allSettled([
      reviewsApi.getAll(),
      restaurantApi.get(),
    ]);

    if (reviewsResult.status === 'fulfilled') setReviews(reviewsResult.value);
    if (restaurantResult.status === 'fulfilled') setCanRespond(Boolean(restaurantResult.value.adminCanRespondReviews));
    const failed = [reviewsResult, restaurantResult].find((result) => result.status === 'rejected') as PromiseRejectedResult | undefined;
    if (failed) setError(failed.reason?.message || 'Не вдалося завантажити відгуки');
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  async function respond(review: GuestReviewRecord) {
    const text = String(drafts[review.id] || '').trim();
    if (!text) return;
    setBusyId(review.id);
    setError(null);
    try {
      const updated = await reviewsApi.respond(review.id, text);
      setReviews((current) => current.map((item) => item.id === updated.id ? updated : item));
      setDrafts((current) => ({ ...current, [review.id]: '' }));
      setNotice('Відповідь збережено');
    } catch (cause: any) {
      setError(cause?.message || 'Не вдалося відповісти на відгук');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="space-y-3">
      <header className="flex items-center justify-between gap-3 rounded-[24px] border border-white/10 bg-neutral-950 p-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-violet-100/50">Без зірок і балів</p>
          <h1 className="mt-1 text-2xl font-black">Письмові відгуки</h1>
          <p className="mt-1 text-xs text-white/40">Відгуки видно завжди. Відповідати можна лише з дозволу Директора.</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="grid h-11 w-11 place-items-center rounded-2xl border border-white/10 bg-white/5 text-white/60 disabled:opacity-40">
          <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
        </button>
      </header>

      {(notice || error) && <div className={`rounded-2xl border px-4 py-3 text-sm ${error ? 'border-red-300/30 bg-red-500/10 text-red-100' : 'border-emerald-300/30 bg-emerald-400/10 text-emerald-100'}`}>{error || notice}</div>}

      <div className="space-y-2">
        {reviews.map((review) => (
          <article key={review.id} className="rounded-[22px] border border-white/10 bg-neutral-950 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-black">{review.booking?.client?.fullName || 'Гість'}</p>
                <p className="mt-1 text-xs text-white/40">{dateLabel(review.booking?.bookingDate)} · Стіл №{review.booking?.table?.tableNumber || '-'}</p>
              </div>
              <MessageSquareText size={19} className="text-violet-200" />
            </div>
            <p className="mt-3 whitespace-pre-wrap text-sm text-white/70">{review.text}</p>

            {review.responseText ? (
              <div className="mt-3 rounded-2xl border border-emerald-300/25 bg-emerald-400/[0.07] p-3">
                <p className="text-[10px] font-black uppercase tracking-[0.16em] text-emerald-100/55">Відповідь</p>
                <p className="mt-2 whitespace-pre-wrap text-sm text-emerald-50">{review.responseText}</p>
                <p className="mt-2 text-[10px] text-white/35">{review.respondedByRole === 'owner' ? 'Директор' : review.respondedByName || 'Адміністратор'}</p>
              </div>
            ) : canRespond ? (
              <div className="mt-3">
                <textarea
                  value={drafts[review.id] || ''}
                  onChange={(event) => setDrafts((current) => ({ ...current, [review.id]: event.target.value }))}
                  placeholder="Напишіть відповідь гостю"
                  className="min-h-24 w-full resize-none rounded-2xl border border-white/10 bg-black/40 p-3 text-sm outline-none focus:border-violet-200/40"
                />
                <button type="button" disabled={busyId === review.id || !String(drafts[review.id] || '').trim()} onClick={() => void respond(review)} className="mt-2 w-full rounded-2xl border border-violet-200/35 bg-violet-400/10 px-3 py-3 text-sm font-black text-violet-100 disabled:opacity-40">Відповісти</button>
              </div>
            ) : (
              <p className="mt-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-xs text-white/40">Директор не надав право відповідати на відгуки.</p>
            )}
          </article>
        ))}
      </div>

      {!reviews.length && <div className="rounded-2xl border border-dashed border-white/10 p-5 text-center text-sm text-white/35">Письмових відгуків ще немає.</div>}
    </section>
  );
}
