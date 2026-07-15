import { useEffect, useLayoutEffect, useState } from 'react';

import { restaurantApi } from '../api/restaurant';
import type { Restaurant, SiteMode } from '../api/types';

type Props = {
  role: 'director' | 'admin';
};

function unwrapRestaurant(value: unknown): Restaurant | null {
  if (!value || typeof value !== 'object') return null;
  const payload = value as Restaurant | { data?: Restaurant };
  return 'data' in payload && payload.data ? payload.data : (payload as Restaurant);
}

function modeLabel(mode: SiteMode | undefined) {
  if (mode === 'day') return 'День';
  if (mode === 'night') return 'Ніч';
  return 'Свято';
}

export default function SiteModeSwitch({ role }: Props) {
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;

    const refresh = () => {
      restaurantApi
        .get()
        .then((response) => {
          if (stopped) return;
          setRestaurant(unwrapRestaurant(response));
          setError(null);
        })
        .catch((loadError: any) => {
          if (!stopped) {
            setError(loadError?.message || 'Не вдалося завантажити режим сайту');
          }
        })
        .finally(() => {
          if (!stopped) setLoaded(true);
        });
    };

    refresh();
    const timer = window.setInterval(refresh, 15_000);

    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, []);

  useLayoutEffect(() => {
    const hideOldModeButtons = () => {
      document.querySelectorAll<HTMLElement>('h2, h3').forEach((heading) => {
        const text = String(heading.textContent || '').trim();
        const isDirectorBlock = text === 'Режим: день, ніч або свято';
        const isAdminBlock = role === 'admin' && text.startsWith('Режим: ');

        if (!isDirectorBlock && !isAdminBlock) return;

        const block = heading.parentElement;
        if (!block || block.dataset.moloLegacyMode === 'true') return;

        block.dataset.moloLegacyMode = 'true';
        block.style.display = 'none';
      });
    };

    hideOldModeButtons();

    const observer = new MutationObserver(hideOldModeButtons);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();

      document
        .querySelectorAll<HTMLElement>('[data-molo-legacy-mode="true"]')
        .forEach((block) => {
          block.style.removeProperty('display');
          delete block.dataset.moloLegacyMode;
        });
    };
  }, [role]);

  if (!loaded || !restaurant) {
    return null;
  }

  const adminAllowed = Boolean(restaurant.adminCanChangeSiteMode);

  if (role === 'admin' && !adminAllowed) {
    return null;
  }

  const currentMode = restaurant.siteMode || 'day';
  const isNight = currentMode === 'night';

  async function toggleMode() {
    if (busy) return;

    const nextMode: SiteMode = isNight ? 'day' : 'night';

    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      if (role === 'admin') {
        await restaurantApi.adminSetSiteMode(nextMode);
      } else {
        await restaurantApi.update({ siteMode: nextMode });
      }

      setRestaurant((current) =>
        current ? { ...current, siteMode: nextMode } : current,
      );
      setNotice(`Увімкнено режим: ${modeLabel(nextMode)}`);
    } catch (switchError: any) {
      setError(switchError?.message || 'Не вдалося змінити режим сайту');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="relative z-40 mx-auto w-full max-w-7xl px-4 pt-4 lg:px-8">
      <div className="rounded-[28px] border border-amber-200/20 bg-neutral-950 p-4 shadow-2xl sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-amber-100/55">
              Оформлення гостьового сайту
            </p>

            <h2 className="mt-1 text-xl font-black text-white">
              Перемикач День / Ніч
            </h2>

            <p className="mt-1 text-sm text-white/45">
              Зараз увімкнено: {modeLabel(currentMode)}
            </p>
          </div>

          <button
            type="button"
            onClick={toggleMode}
            disabled={busy}
            aria-label="Перемкнути денний або нічний режим"
            className="relative grid h-14 w-full max-w-[260px] grid-cols-2 overflow-hidden rounded-full border border-amber-200/35 bg-black p-1 text-sm font-black text-white/55 transition active:scale-[0.98] disabled:opacity-50 sm:w-[260px]"
          >
            <span
              className={`absolute bottom-1 left-1 top-1 w-[calc(50%-4px)] rounded-full bg-amber-300 shadow-[0_0_28px_rgba(251,191,36,.22)] transition-transform duration-300 ${
                isNight ? 'translate-x-full' : 'translate-x-0'
              }`}
            />

            <span
              className={`relative z-10 flex items-center justify-center ${
                !isNight ? 'text-neutral-950' : ''
              }`}
            >
              День
            </span>

            <span
              className={`relative z-10 flex items-center justify-center ${
                isNight ? 'text-neutral-950' : ''
              }`}
            >
              Ніч
            </span>
          </button>
        </div>

        {(notice || error) && (
          <div
            className={`mt-4 rounded-2xl border px-4 py-3 text-sm ${
              error
                ? 'border-red-300/30 bg-red-500/10 text-red-100'
                : 'border-emerald-300/30 bg-emerald-400/10 text-emerald-100'
            }`}
          >
            {error || notice}
          </div>
        )}
      </div>
    </section>
  );
}
