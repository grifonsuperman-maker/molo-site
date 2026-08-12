import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { restaurantApi } from '../api/restaurant';
import type { Restaurant } from '../api/types';

function findSiteSection(): HTMLElement | null {
  const heading = Array.from(document.querySelectorAll('h1')).find(
    (element) => element.textContent?.trim() === 'Сайт',
  );
  const headingCard = heading?.closest('section');
  const siteSection = headingCard?.parentElement;

  return siteSection?.tagName === 'SECTION' ? siteSection : null;
}

function refreshDirectorPanel() {
  document
    .querySelector<HTMLButtonElement>('button[aria-label="Оновити"]')
    ?.click();
}

export default function DirectorSiteControlsDock() {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [phone, setPhone] = useState('');
  const [phoneDirty, setPhoneDirty] = useState(false);
  const [busy, setBusy] = useState<'site' | 'phone' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let host: HTMLDivElement | null = null;

    function syncTarget() {
      const siteSection = findSiteSection();

      if (!siteSection) {
        if (host) host.remove();
        host = null;
        setTarget(null);
        return;
      }

      if (host?.parentElement === siteSection) return;

      if (host) host.remove();
      host = document.createElement('div');
      host.dataset.directorSiteControls = 'true';
      host.className = 'space-y-3';
      siteSection.appendChild(host);
      setTarget(host);
    }

    syncTarget();
    const observer = new MutationObserver(syncTarget);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      if (host) host.remove();
    };
  }, []);

  useEffect(() => {
    if (!target) return;

    let active = true;
    setError(null);

    restaurantApi
      .get()
      .then((value) => {
        if (!active) return;
        setRestaurant(value);
        setPhone(value.phone || '');
        setPhoneDirty(false);
      })
      .catch((cause: any) => {
        if (active) setError(cause?.message || 'Не вдалося завантажити налаштування сайту');
      });

    return () => {
      active = false;
    };
  }, [target]);

  if (!target) return null;

  async function toggleSite() {
    if (!restaurant || busy) return;

    setBusy('site');
    setNotice(null);
    setError(null);

    try {
      if (restaurant.status === 'closed') {
        await restaurantApi.open();
      } else {
        await restaurantApi.close(
          restaurant.closeMessage || 'Ресторан тимчасово зачинений',
        );
      }

      const updated = await restaurantApi.get();
      setRestaurant(updated);
      refreshDirectorPanel();
      setNotice(
        updated.status === 'closed'
          ? 'Сайт закрито для гостей'
          : 'Сайт відкрито для гостей',
      );
    } catch (cause: any) {
      setError(cause?.message || 'Не вдалося змінити доступність сайту');
    } finally {
      setBusy(null);
    }
  }

  async function savePhone() {
    if (busy || !phoneDirty) return;

    setBusy('phone');
    setNotice(null);
    setError(null);

    try {
      await restaurantApi.update({ phone: phone.trim() || null });
      const updated = await restaurantApi.get();
      setRestaurant(updated);
      setPhone(updated.phone || '');
      setPhoneDirty(false);
      setNotice(
        updated.phone
          ? 'Телефон адміністратора збережено'
          : 'Телефон адміністратора видалено',
      );
    } catch (cause: any) {
      setError(cause?.message || 'Не вдалося зберегти телефон адміністратора');
    } finally {
      setBusy(null);
    }
  }

  return createPortal(
    <>
      {(notice || error) && (
        <div
          className={`rounded-2xl border bg-black/55 px-4 py-3 text-sm ${
            error
              ? 'border-rose-300/35 text-rose-100'
              : 'border-emerald-200/35 text-emerald-100'
          }`}
        >
          {error || notice}
        </div>
      )}

      <section className="rounded-[24px] border border-amber-100/15 bg-black/45 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,.035),0_0_28px_rgba(251,191,36,.055),0_18px_50px_rgba(0,0,0,.28)] backdrop-blur-xl">
        <p className="text-[10px] font-black uppercase tracking-[0.22em] text-amber-100/45">
          Доступ для гостей
        </p>
        <h2 className="mt-1 text-xl font-black">Відкрити / закрити сайт</h2>
        <p className="mt-2 text-sm text-white/45">
          {restaurant?.status === 'closed'
            ? 'Сайт закритий. Гостям показується повідомлення про закриття ресторану.'
            : 'Сайт відкритий і доступний гостям.'}
        </p>
        <button
          type="button"
          disabled={!restaurant || Boolean(busy)}
          onClick={() => void toggleSite()}
          className={`mt-4 inline-flex w-full items-center justify-center rounded-2xl border bg-black/35 px-4 py-3 text-sm font-black transition active:scale-[.985] disabled:opacity-35 ${
            restaurant?.status === 'closed'
              ? 'border-emerald-200/35 text-emerald-100'
              : 'border-rose-200/35 text-rose-100'
          }`}
        >
          {busy === 'site'
            ? 'Зачекайте...'
            : restaurant?.status === 'closed'
              ? 'Відкрити сайт'
              : 'Закрити сайт'}
        </button>
      </section>

      <section className="rounded-[24px] border border-amber-100/15 bg-black/45 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,.035),0_0_28px_rgba(251,191,36,.055),0_18px_50px_rgba(0,0,0,.28)] backdrop-blur-xl">
        <p className="text-[10px] font-black uppercase tracking-[0.22em] text-amber-100/45">
          Зв’язок з адміністратором
        </p>
        <h2 className="mt-1 text-xl font-black">Телефон адміністратора</h2>
        <p className="mt-2 text-sm text-white/45">
          Цей номер використовує кнопка «Зателефонувати адміністратору» на сторінці гостя.
        </p>
        <input
          type="tel"
          value={phone}
          onChange={(event) => {
            setPhone(event.target.value);
            setPhoneDirty(true);
          }}
          placeholder="Введіть номер телефону"
          autoComplete="tel"
          className="mt-4 h-12 w-full rounded-2xl border border-white/12 bg-black/45 px-4 text-sm outline-none focus:border-amber-100/40"
        />
        <button
          type="button"
          disabled={busy === 'phone' || !phoneDirty}
          onClick={() => void savePhone()}
          className="mt-3 inline-flex w-full items-center justify-center rounded-2xl border border-amber-100/40 bg-black/35 px-4 py-3 text-sm font-black text-amber-100 transition active:scale-[.985] disabled:opacity-35"
        >
          {busy === 'phone'
            ? 'Зберігаємо...'
            : phoneDirty
              ? 'Зберегти номер'
              : 'Номер збережено'}
        </button>
      </section>
    </>,
    target,
  );
}
