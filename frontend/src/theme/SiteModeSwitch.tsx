import { useEffect, useLayoutEffect, useState } from 'react';

import { restaurantApi } from '../api/restaurant';
import type { HolidayKey, Restaurant, SiteMode } from '../api/types';

type Props = {
  role: 'director' | 'admin';
};

const HOLIDAYS: Array<{ key: HolidayKey; label: string }> = [
  { key: 'new-year', label: 'Новий рік' },
  { key: 'christmas', label: 'Різдво' },
  { key: 'valentines', label: 'День закоханих' },
  { key: 'easter', label: 'Великдень' },
  { key: 'halloween', label: 'Геловін' },
  { key: 'march-8', label: '8 Березня' },
];

function unwrapRestaurant(value: unknown): Restaurant | null {
  if (!value || typeof value !== 'object') return null;
  const payload = value as Restaurant | { data?: Restaurant };
  return 'data' in payload && payload.data ? payload.data : (payload as Restaurant);
}

function holidayLabel(holidayKey: HolidayKey | null | undefined) {
  return HOLIDAYS.find((holiday) => holiday.key === holidayKey)?.label || 'Свято';
}

function modeLabel(
  mode: SiteMode | undefined,
  holidayKey?: HolidayKey | null,
) {
  if (mode === 'day') return 'День';
  if (mode === 'night') return 'Ніч';
  return holidayLabel(holidayKey);
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
            setError(loadError?.message || 'Не вдалося завантажити оформлення сайту');
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
  const currentHoliday = restaurant.holidayKey || null;
  const isNight = currentMode === 'night';

  async function applyMode(
    nextMode: SiteMode,
    holidayKey: HolidayKey | null = null,
  ) {
    if (busy) return;

    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      if (role === 'admin') {
        await restaurantApi.adminSetSiteMode(nextMode, holidayKey);
      } else {
        await restaurantApi.update({
          siteMode: nextMode,
          holidayKey,
        });
      }

      setRestaurant((current) =>
        current
          ? {
              ...current,
              siteMode: nextMode,
              holidayKey: nextMode === 'holiday' ? holidayKey : null,
            }
          : current,
      );
      setNotice(`Увімкнено оформлення: ${modeLabel(nextMode, holidayKey)}`);
    } catch (switchError: any) {
      setError(switchError?.message || 'Не вдалося змінити оформлення сайту');
    } finally {
      setBusy(false);
    }
  }

  function toggleDayNight() {
    const nextMode: SiteMode = currentMode === 'day' ? 'night' : 'day';
    void applyMode(nextMode, null);
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
              День / Ніч / Свято
            </h2>

            <p className="mt-1 text-sm text-white/45">
              Зараз увімкнено: {modeLabel(currentMode, currentHoliday)}
            </p>
          </div>

          <button
            type="button"
            onClick={toggleDayNight}
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
                !isNight && currentMode !== 'holiday' ? 'text-neutral-950' : ''
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

        <div className="mt-5 border-t border-white/10 pt-5">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-white/40">
                Святкове оформлення
              </p>
              <h3 className="mt-1 text-lg font-black text-white">
                Оберіть свято
              </h3>
            </div>

            <p className="text-xs text-white/40">
              Титульна сторінка не змінюється
            </p>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {HOLIDAYS.map((holiday) => {
              const active =
                currentMode === 'holiday' && currentHoliday === holiday.key;

              return (
                <button
                  key={holiday.key}
                  type="button"
                  onClick={() => applyMode('holiday', holiday.key)}
                  disabled={busy}
                  className={`rounded-2xl border px-3 py-3 text-sm font-bold transition active:scale-[0.98] disabled:opacity-50 ${
                    active
                      ? 'border-rose-200/60 bg-rose-400/20 text-rose-50 shadow-[0_0_24px_rgba(251,113,133,.14)]'
                      : 'border-white/10 bg-white/[0.03] text-white/70'
                  }`}
                >
                  {holiday.label}
                </button>
              );
            })}
          </div>

          <p className="mt-3 text-xs leading-relaxed text-white/40">
            Якщо святкове фото ще не завантажене, сайт автоматично залишить денне фото без помилки.
          </p>
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
