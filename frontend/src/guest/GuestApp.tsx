import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Clock,
  Menu,
  Phone,
  Users,
} from 'lucide-react';

import type { FullMapResponse, MapObject, Restaurant, TableItem, Zone } from '../api/types';
import { mapApi } from '../api/map';
import { restaurantApi } from '../api/restaurant';
import { bookingsApi } from '../api/bookings';
import { useAsyncAction } from '../hooks/useAsyncAction';

const FALLBACK_MENU =
  'https://expz.menu/8ec3f3d4-0e9f-4ed7-a03f-5f4deaba843e?utm_source=ig&utm_medium=social&utm_content=link_in_bio';

type Step = 'home' | 'map' | 'form' | 'success';
type TableStatus = 'free' | 'reserved' | 'occupied' | 'closed';

const STATUS_TEXT: Record<TableStatus, string> = {
  free: 'Вільний',
  reserved: 'Бронь',
  occupied: 'Зайнятий',
  closed: 'Закритий',
};

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeTableStatus(status: unknown): TableStatus {
  if (status === 'reserved' || status === 'booked') return 'reserved';
  if (status === 'occupied') return 'occupied';
  if (status === 'closed') return 'closed';
  return 'free';
}

function getRestaurantFromResponse(value: unknown): Restaurant | null {
  if (!value || typeof value !== 'object') return null;

  const data = value as any;
  return data.data ?? data;
}

function getMapFromResponse(value: unknown): FullMapResponse | null {
  if (!value || typeof value !== 'object') return null;

  const data = value as any;
  return data.data ?? data;
}

function mapWidth(map: FullMapResponse | null) {
  return numberValue(map?.restaurant?.mapWidth, 1200);
}

function mapHeight(map: FullMapResponse | null) {
  return numberValue(map?.restaurant?.mapHeight, 800);
}

/**
 * ВАЖНО:
 * Координаты переводятся в проценты.
 * Поэтому карта уменьшается на телефоне вместе со столами,
 * и подсветка не уезжает в сторону.
 */
function toPercent(value: unknown, total: number) {
  const safeTotal = total || 1;
  return `${(numberValue(value) / safeTotal) * 100}%`;
}

function mapItemStyle(
  item: {
    x?: unknown;
    y?: unknown;
    width?: unknown;
    height?: unknown;
    rotation?: unknown;
  },
  currentMapWidth: number,
  currentMapHeight: number,
  fallbackWidth: number,
  fallbackHeight: number,
): CSSProperties {
  return {
    left: toPercent(item.x, currentMapWidth),
    top: toPercent(item.y, currentMapHeight),
    width: toPercent(numberValue(item.width, fallbackWidth), currentMapWidth),
    height: toPercent(numberValue(item.height, fallbackHeight), currentMapHeight),
    transform: `rotate(${numberValue(item.rotation)}deg)`,
    transformOrigin: 'center center',
  };
}

/**
 * ЛОГИКА СВЕЧЕНИЯ СТОЛОВ:
 *
 * 1. Свободный стол НЕ светится целый день.
 * 2. Когда человек нажал на свободный стол — только он светится золотым.
 * 3. Бронь — мягкий янтарный статус.
 * 4. Занятый — красный статус.
 * 5. Закрытый — серый приглушённый статус.
 */
function tableGlowClass(table: TableItem, selected: boolean) {
  const status = normalizeTableStatus(table.status);

  if (selected) {
    return 'border-amber-100 bg-amber-400/30 shadow-[0_0_0_2px_rgba(251,191,36,.80),0_0_22px_rgba(251,191,36,.75),0_0_42px_rgba(251,191,36,.45),inset_0_0_18px_rgba(253,230,138,.30)]';
  }

  if (status === 'reserved') {
    return 'border-amber-300 bg-amber-500/25 shadow-[0_0_14px_rgba(251,191,36,.45)]';
  }

  if (status === 'occupied') {
    return 'border-red-300 bg-red-500/30 shadow-[0_0_14px_rgba(248,113,113,.45)]';
  }

  if (status === 'closed') {
    return 'border-neutral-300 bg-neutral-600/35 shadow-none';
  }

  return 'border-white/35 bg-white/10 shadow-none';
}

function objectBackground(object: MapObject) {
  if (object.objectType === 'floor_marble') {
    return 'linear-gradient(135deg, rgba(255,255,255,.9), rgba(255,255,255,.35)), repeating-linear-gradient(45deg, #d8d3c7, #d8d3c7 22px, #f5f5f4 22px, #f5f5f4 28px, #a8a29e 28px, #a8a29e 44px)';
  }

  if (object.objectType === 'floor_water') {
    return 'linear-gradient(135deg, #082f49, #075985, #020617)';
  }

  if (object.objectType === 'floor_grass') {
    return 'repeating-linear-gradient(45deg, #365314, #365314 12px, #65a30d 12px, #65a30d 20px)';
  }

  if (object.objectType === 'window') {
    return 'linear-gradient(180deg, #7dd3fc, #38bdf8, #0f172a)';
  }

  if (object.objectType === 'fireplace') {
    return 'radial-gradient(circle, #fde68a 0%, #f97316 35%, #dc2626 68%, #450a0a 100%)';
  }

  if (object.objectType === 'lamp_post' || object.objectType === 'spot_light') {
    return 'radial-gradient(circle, #fef08a 0%, #facc15 35%, transparent 72%)';
  }

  return object.color || '#525252';
}

function objectRadius(object: MapObject) {
  if (
    object.objectType.includes('round') ||
    object.objectType === 'bush' ||
    object.objectType === 'tree'
  ) {
    return '999px';
  }

  if (object.objectType.startsWith('floor_')) return '26px';

  return '14px';
}

export default function GuestApp() {
  const [step, setStep] = useState<Step>('home');
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [map, setMap] = useState<FullMapResponse | null>(null);
  const [selectedTable, setSelectedTable] = useState<TableItem | null>(null);

  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState('19:00');

  const [form, setForm] = useState({
    fullName: '',
    phone: '',
    guestsCount: 2,
    wishes: '',
  });

  const { loading, error, run } = useAsyncAction();

  useEffect(() => {
    restaurantApi
      .get()
      .then((response) => setRestaurant(getRestaurantFromResponse(response)))
      .catch(() => {});

    mapApi
      .get()
      .then((response) => setMap(getMapFromResponse(response)))
      .catch(() => {});
  }, []);

  const visibleTables = useMemo(() => {
    return (map?.tables || []).filter((table) => table.isVisible !== false);
  }, [map]);

  const visibleZones = useMemo(() => {
    return (map?.zones || []).filter((zone) => zone.isVisible !== false);
  }, [map]);

  const visibleObjects = useMemo(() => {
    return (map?.objects || []).filter((object) => object.isVisible !== false);
  }, [map]);

  const currentMapWidth = mapWidth(map);
  const currentMapHeight = mapHeight(map);

  function callAdmin() {
    if (restaurant?.phone) {
      window.location.href = `tel:${restaurant.phone}`;
      return;
    }

    alert('Телефон адміністратора ще не додано.');
  }

  function openMenu() {
    window.open(restaurant?.menuUrl || FALLBACK_MENU, '_blank');
  }

  function goBack() {
    if (step === 'form') {
      setStep('map');
      return;
    }

    setStep('home');
  }

  function selectTable(table: TableItem) {
    const status = normalizeTableStatus(table.status);

    if (restaurant?.status === 'booking_closed' || status !== 'free' || table.zone?.isClosed) {
      callAdmin();
      return;
    }

    setSelectedTable(table);
  }

  function continueWithSelectedTable() {
    if (!selectedTable) return;
    setStep('form');
  }

  async function submit() {
    if (!selectedTable) return;

    const result = await run(() =>
      bookingsApi.create({
        tableId: selectedTable.id,
        fullName: form.fullName,
        phone: form.phone,
        bookingDate: date,
        bookingTime: time,
        guestsCount: Number(form.guestsCount),
        wishes: form.wishes,
      }),
    );

    if (result) setStep('success');
  }

  if (restaurant?.status === 'closed') {
    return (
      <section className="rounded-3xl border border-red-500/30 bg-red-950/40 p-6 text-center">
        <h1 className="text-2xl font-semibold">Ресторан зачинений</h1>
        <p className="mt-3 whitespace-pre-line text-neutral-300">{restaurant.closeMessage}</p>
      </section>
    );
  }

  return (
    <div className="-mx-4 -my-5 min-h-[calc(100vh-6rem)] overflow-hidden bg-black px-4 py-5 text-white sm:-mx-6 sm:px-6">
      {step !== 'home' && (
        <button
          onClick={goBack}
          className="relative z-20 mb-4 flex items-center gap-2 rounded-full border border-white/15 bg-black/35 px-4 py-2 text-sm text-neutral-200 backdrop-blur-md"
        >
          <ArrowLeft className="h-4 w-4" />
          Назад
        </button>
      )}

      {step === 'home' && (
        <section className="relative flex min-h-[calc(100vh-8rem)] items-center justify-center overflow-hidden rounded-[34px] border border-white/10 bg-black shadow-2xl">
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{
              backgroundImage: 'url("/hero-bg.jpg")',
            }}
          />

          <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/45 to-black/85" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_15%,rgba(250,204,21,.22),transparent_35%)]" />

          <div className="relative z-10 w-full max-w-5xl px-5 py-10 text-center sm:px-10">
            <div className="mx-auto flex max-w-3xl flex-col items-center rounded-[34px] border border-white/15 bg-black/35 px-5 py-8 shadow-2xl backdrop-blur-xl sm:px-12 sm:py-12">
              <img
                src="/logo.png"
                alt="MOLO"
                className="h-40 w-auto max-w-[85%] object-contain drop-shadow-[0_20px_45px_rgba(0,0,0,.85)] sm:h-56"
              />

              <p className="mt-5 text-xs uppercase tracking-[0.55em] text-amber-200 sm:text-sm">
                Restaurant
              </p>

              <h1 className="mt-3 text-5xl font-semibold tracking-[0.12em] text-white sm:text-7xl">
                MOLO
              </h1>

              <p className="mt-5 max-w-xl text-base leading-relaxed text-neutral-200 sm:text-xl">
                Бронювання столиків, меню та звʼязок з адміністратором.
              </p>

              <div className="mt-8 grid w-full max-w-xl gap-3">
                <button
                  onClick={() => {
                    setSelectedTable(null);
                    setStep('map');
                  }}
                  className="rounded-2xl border border-amber-200/80 bg-amber-300/10 px-5 py-4 text-base font-semibold text-amber-100 shadow-[0_0_30px_rgba(251,191,36,.14)] backdrop-blur-md transition hover:bg-amber-300/20"
                >
                  Забронювати столик
                </button>

                <button
                  onClick={openMenu}
                  className="flex items-center justify-center gap-3 rounded-2xl border border-white/20 bg-white/5 px-5 py-4 text-base font-semibold text-white backdrop-blur-md transition hover:bg-white/10"
                >
                  <Menu className="h-5 w-5 text-amber-200" />
                  Меню
                </button>

                <button
                  onClick={callAdmin}
                  className="flex items-center justify-center gap-3 rounded-2xl border border-emerald-300/35 bg-emerald-300/5 px-5 py-4 text-base font-semibold text-white backdrop-blur-md transition hover:bg-emerald-300/10"
                >
                  <Phone className="h-5 w-5 text-emerald-300" />
                  Зателефонувати адміністратору
                </button>
              </div>

              <p className="mt-6 text-sm text-neutral-300">
                Ми працюємо з 10:00 до 23:00
              </p>
            </div>
          </div>
        </section>
      )}

      {step === 'map' && (
        <section className="rounded-[34px] border border-white/10 bg-neutral-950/90 p-4 shadow-2xl backdrop-blur-xl">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold">Карта ресторану</h1>
              <p className="mt-1 text-sm text-neutral-400">
                Оберіть дату, час і вільний стіл.
              </p>
            </div>

            <button
              onClick={() =>
                mapApi
                  .get()
                  .then((response) => setMap(getMapFromResponse(response)))
                  .catch(() => {})
              }
              className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs text-neutral-200"
            >
              Оновити
            </button>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="rounded-2xl border border-white/10 bg-white/5 p-3">
              <span className="flex items-center gap-2 text-sm text-neutral-300">
                <CalendarDays className="h-4 w-4 text-amber-200" />
                Дата
              </span>

              <input
                value={date}
                onChange={(event) => {
                  setDate(event.target.value);
                  setSelectedTable(null);
                }}
                type="date"
                className="mt-2 w-full bg-transparent text-sm outline-none"
              />
            </label>

            <label className="rounded-2xl border border-white/10 bg-white/5 p-3">
              <span className="flex items-center gap-2 text-sm text-neutral-300">
                <Clock className="h-4 w-4 text-amber-200" />
                Час
              </span>

              <input
                value={time}
                onChange={(event) => {
                  setTime(event.target.value);
                  setSelectedTable(null);
                }}
                type="time"
                step="300"
                className="mt-2 w-full bg-transparent text-sm outline-none"
              />
            </label>
          </div>

          {restaurant?.status === 'booking_closed' && (
            <div className="mt-4 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-100">
              {restaurant.bookingClosedMessage}
            </div>
          )}

          <div className="mt-5 rounded-[28px] border border-white/10 bg-black/50 p-3">
            <div
              className="relative mx-auto w-full overflow-hidden rounded-[24px] bg-[#12100c]"
              style={{
                maxWidth: currentMapWidth,
                aspectRatio: `${currentMapWidth} / ${currentMapHeight}`,
                backgroundImage:
                  'radial-gradient(circle at 15% 15%, rgba(251,191,36,.10), transparent 28%), linear-gradient(135deg, #0f0d0a, #1c1710)',
                backgroundSize: '100% 100%',
                backgroundPosition: 'center',
                backgroundRepeat: 'no-repeat',
              }}
            >
              {visibleZones.map((zone: Zone) => {
                const zoneStyle = mapItemStyle(
                  zone,
                  currentMapWidth,
                  currentMapHeight,
                  260,
                  180,
                );

                return (
                  <div
                    key={zone.id}
                    className="absolute z-[1] flex items-center justify-center rounded-3xl border border-amber-200/25 bg-white/5 text-center text-xs font-semibold text-white/70 shadow-[0_0_18px_rgba(251,191,36,.18)]"
                    style={{
                      ...zoneStyle,
                      backgroundColor: zone.color || 'rgba(255,255,255,.05)',
                    }}
                  >
                    {zone.isClosed ? '🔒 ' : ''}
                    {zone.name}
                  </div>
                );
              })}

              {visibleObjects.map((object: MapObject) => {
                const objectStyle = mapItemStyle(
                  object,
                  currentMapWidth,
                  currentMapHeight,
                  100,
                  100,
                );

                return (
                  <div
                    key={object.id}
                    className="absolute z-[2] flex items-center justify-center border border-white/10 text-[10px] font-semibold text-white/70"
                    style={{
                      ...objectStyle,
                      background: objectBackground(object),
                      borderRadius: objectRadius(object),
                    }}
                  >
                    {object.name || ''}
                  </div>
                );
              })}

              {visibleTables.map((table: TableItem) => {
                const status = normalizeTableStatus(table.status);
                const selected = selectedTable?.id === table.id;
                const isBlocked =
                  restaurant?.status === 'booking_closed' ||
                  status !== 'free' ||
                  table.zone?.isClosed;

                const tableStyle = mapItemStyle(
                  table,
                  currentMapWidth,
                  currentMapHeight,
                  86,
                  86,
                );

                return (
                  <button
                    key={table.id}
                    onClick={() => selectTable(table)}
                    className={`absolute z-10 flex items-center justify-center border-2 text-xs font-bold text-white transition duration-150 active:scale-95 ${
                      table.shape === 'round' ? 'rounded-full' : 'rounded-xl'
                    } ${tableGlowClass(table, selected)}`}
                    style={tableStyle}
                    title={STATUS_TEXT[status]}
                  >
                    {isBlocked && status === 'closed' ? (
                      <span className="absolute inset-0 flex items-center justify-center rounded-[inherit] bg-black/45 text-3xl text-red-300">
                        ✕
                      </span>
                    ) : null}

                    <span className="relative z-10 rounded-full bg-black/35 px-2 py-1 shadow-[0_0_12px_rgba(0,0,0,.65)]">
                      {table.tableNumber}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-3 text-xs text-neutral-300">
            <span className="flex items-center gap-2">
              <i className="h-3 w-3 rounded-full border border-white/35 bg-white/20" />
              Вільний
            </span>

            <span className="flex items-center gap-2">
              <i className="h-3 w-3 rounded-full bg-amber-500 shadow-[0_0_10px_rgba(251,191,36,.45)]" />
              Бронь
            </span>

            <span className="flex items-center gap-2">
              <i className="h-3 w-3 rounded-full bg-red-500 shadow-[0_0_10px_rgba(248,113,113,.45)]" />
              Зайнятий
            </span>

            <span className="flex items-center gap-2">
              <i className="h-3 w-3 rounded-full bg-neutral-500" />
              Закритий
            </span>

            <span className="flex items-center gap-2">
              <i className="h-3 w-3 rounded-full bg-amber-300 shadow-[0_0_14px_rgba(251,191,36,.85)]" />
              Обраний стіл
            </span>
          </div>

          {selectedTable && (
            <button
              onClick={continueWithSelectedTable}
              className="mt-4 w-full rounded-2xl border border-amber-200/80 bg-amber-300/10 px-5 py-4 font-semibold text-amber-100 shadow-[0_0_24px_rgba(251,191,36,.22)] transition hover:bg-amber-300/20"
            >
              Продовжити зі столом №{selectedTable.tableNumber}
            </button>
          )}
        </section>
      )}

      {step === 'form' && selectedTable && (
        <section className="rounded-[34px] border border-white/10 bg-neutral-950/90 p-5 shadow-2xl backdrop-blur-xl">
          <h1 className="text-2xl font-semibold">Стіл №{selectedTable.tableNumber}</h1>

          <p className="mt-2 text-neutral-300">
            до {selectedTable.seats} гостей · {date} · {time}
          </p>

          <div className="mt-5 grid gap-3">
            <input
              placeholder="Ваше імʼя"
              value={form.fullName}
              onChange={(event) => setForm({ ...form, fullName: event.target.value })}
              className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 outline-none"
            />

            <input
              placeholder="Телефон"
              value={form.phone}
              onChange={(event) => setForm({ ...form, phone: event.target.value })}
              className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 outline-none"
            />

            <label className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
              <span className="mb-2 flex items-center gap-2 text-sm text-neutral-300">
                <Users className="h-4 w-4 text-amber-200" />
                Кількість гостей
              </span>

              <input
                type="number"
                min={1}
                value={form.guestsCount}
                onChange={(event) =>
                  setForm({ ...form, guestsCount: Number(event.target.value) })
                }
                className="w-full bg-transparent outline-none"
              />
            </label>

            <textarea
              placeholder="Примітка"
              value={form.wishes}
              onChange={(event) => setForm({ ...form, wishes: event.target.value })}
              className="min-h-24 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 outline-none"
            />

            {error && <p className="text-sm text-red-300">{error}</p>}

            <button
              disabled={loading}
              onClick={submit}
              className="w-full rounded-2xl border border-amber-200/80 bg-amber-300/10 px-5 py-4 font-semibold text-amber-100 disabled:opacity-50"
            >
              {loading ? 'Надсилаємо...' : 'Надіслати заявку'}
            </button>
          </div>
        </section>
      )}

      {step === 'success' && (
        <section className="rounded-[34px] border border-emerald-400/25 bg-emerald-950/40 p-6 text-center shadow-2xl backdrop-blur-xl">
          <CheckCircle2 className="mx-auto mb-4 h-12 w-12 text-emerald-400" />

          <h1 className="text-2xl font-semibold">Заявку надіслано</h1>

          <p className="mt-3 text-neutral-300">
            Адміністратор отримає заявку та підтвердить бронювання.
          </p>

          <button
            onClick={() => {
              setSelectedTable(null);
              setStep('home');
            }}
            className="mt-6 w-full rounded-2xl border border-amber-200/80 bg-amber-300/10 px-5 py-4 font-semibold text-amber-100"
          >
            На головну
          </button>
        </section>
      )}
    </div>
  );
}
