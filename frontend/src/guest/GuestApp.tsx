import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Clock,
  MapPin,
  Menu,
  Phone,
  RefreshCcw,
  Users,
} from 'lucide-react';

import type { FullMapResponse, Restaurant, TableItem } from '../api/types';
import { bookingsApi } from '../api/bookings';
import { mapApi } from '../api/map';
import { restaurantApi } from '../api/restaurant';
import { useAsyncAction } from '../hooks/useAsyncAction';

const FALLBACK_MENU =
  'https://expz.menu/8ec3f3d4-0e9f-4ed7-a03f-5f4deaba843e?utm_source=ig&utm_medium=social&utm_content=link_in_bio';

type Step = 'entry' | 'waterfront' | 'zone' | 'form' | 'success';
type TableStatusView = 'free' | 'reserved' | 'occupied' | 'closed';

type LocationId =
  | 'hall'
  | 'canopy'
  | 'gazebo'
  | 'rotang'
  | 'embankment'
  | 'pier'
  | 'water_pier';

type LocationConfig = {
  id: LocationId;
  label: string;
  shortLabel: string;
  background: string;
  fallbackText: string;
  zoneKeywords: string[];
};

const LOCATIONS: LocationConfig[] = [
  {
    id: 'hall',
    label: 'Зал',
    shortLabel: 'Зал',
    background: '/maps/hall-bg.png',
    fallbackText: 'Фон залу ще не завантажено',
    zoneKeywords: ['зал', 'hall', 'restaurant', 'ресторан'],
  },
  {
    id: 'canopy',
    label: 'Навіс',
    shortLabel: 'Навіс',
    background: '/maps/canopy-bg.png',
    fallbackText: 'Фон навісу ще не завантажено',
    zoneKeywords: ['навіс', 'навес', 'canopy'],
  },
  {
    id: 'gazebo',
    label: 'Велика бесідка',
    shortLabel: 'Бесідка',
    background: '/maps/gazebo-bg.png',
    fallbackText: 'Фон великої бесідки ще не завантажено',
    zoneKeywords: ['бесідка', 'беседка', 'gazebo'],
  },
  {
    id: 'rotang',
    label: 'Ротанг',
    shortLabel: 'Ротанг',
    background: '/maps/rotang-bg.png',
    fallbackText: 'Фон ротангу ще не завантажено',
    zoneKeywords: ['ротанг', 'rotang', 'rattan'],
  },
  {
    id: 'embankment',
    label: 'Набережна',
    shortLabel: 'Набережна',
    background: '/maps/embankment-bg.png',
    fallbackText: 'Фон набережної ще не завантажено',
    zoneKeywords: ['набережна', 'набережная', 'embankment', 'waterfront'],
  },
  {
    id: 'pier',
    label: 'Причал',
    shortLabel: 'Причал',
    background: '/maps/pier-bg.png',
    fallbackText: 'Фон причалу ще не завантажено',
    zoneKeywords: ['причал', 'pier'],
  },
  {
    id: 'water_pier',
    label: 'Причал на воді',
    shortLabel: 'На воді',
    background: '/maps/water-pier-bg.png',
    fallbackText: 'Фон причалу на воді ще не завантажено',
    zoneKeywords: ['воді', 'воде', 'water'],
  },
];

const WATERFRONT_LOCATIONS = LOCATIONS.filter((location) => location.id !== 'hall');

const STATUS_TEXT: Record<TableStatusView, string> = {
  free: 'Вільний',
  reserved: 'Заброньовано',
  occupied: 'Зайнятий',
  closed: 'Закритий',
};

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeTableStatus(status: unknown): TableStatusView {
  if (status === 'reserved' || status === 'booked') return 'reserved';
  if (status === 'occupied') return 'occupied';
  if (status === 'closed') return 'closed';
  return 'free';
}

function getRestaurantFromResponse(value: unknown): Restaurant | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as { data?: Restaurant };
  return data.data ?? (value as Restaurant);
}

function getMapFromResponse(value: unknown): FullMapResponse | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as { data?: FullMapResponse };
  return data.data ?? (value as FullMapResponse);
}

function mapWidth(map: FullMapResponse | null) {
  return numberValue(map?.restaurant?.mapWidth, 2200);
}

function mapHeight(map: FullMapResponse | null) {
  return numberValue(map?.restaurant?.mapHeight, 1500);
}

function toPercent(value: unknown, total: number) {
  const safeTotal = total || 1;
  return `${(numberValue(value) / safeTotal) * 100}%`;
}

function tableStyle(
  table: TableItem,
  currentMapWidth: number,
  currentMapHeight: number,
): CSSProperties {
  return {
    left: toPercent(table.x, currentMapWidth),
    top: toPercent(table.y, currentMapHeight),
    width: toPercent(numberValue(table.width, 86), currentMapWidth),
    height: toPercent(numberValue(table.height, 86), currentMapHeight),
    transform: `rotate(${numberValue(table.rotation)}deg)`,
    transformOrigin: 'center center',
  };
}

function tableClasses(table: TableItem, selected: boolean) {
  const status = normalizeTableStatus(table.status);

  if (selected) {
    return 'border-amber-100 bg-amber-400/30 shadow-[0_0_0_2px_rgba(251,191,36,.80),0_0_22px_rgba(251,191,36,.75),0_0_42px_rgba(251,191,36,.45),inset_0_0_18px_rgba(253,230,138,.30)]';
  }

  if (status === 'reserved') {
    return 'border-amber-200 bg-amber-500/35 shadow-[0_0_16px_rgba(251,191,36,.48)]';
  }

  if (status === 'occupied') {
    return 'border-red-200 bg-red-600/40 shadow-[0_0_16px_rgba(248,113,113,.48)]';
  }

  if (status === 'closed') {
    return 'border-neutral-300 bg-neutral-600/40 shadow-none';
  }

  return 'border-white/35 bg-white/10 shadow-none';
}

function tableLabel(table: TableItem) {
  return `Стіл ${table.tableNumber}`;
}

function tableMatchesLocation(table: TableItem, location: LocationConfig) {
  const zoneName = table.zone?.name?.toLowerCase();

  if (!zoneName) {
    return true;
  }

  return location.zoneKeywords.some((keyword) => zoneName.includes(keyword));
}

export default function GuestApp() {
  const [step, setStep] = useState<Step>('entry');
  const [activeLocationId, setActiveLocationId] = useState<LocationId>('hall');
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

  const activeLocation =
    LOCATIONS.find((location) => location.id === activeLocationId) ?? LOCATIONS[0];

  const currentMapWidth = mapWidth(map);
  const currentMapHeight = mapHeight(map);

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

  const locationTables = useMemo(() => {
    return visibleTables.filter((table) => tableMatchesLocation(table, activeLocation));
  }, [activeLocation, visibleTables]);

  function refreshMap() {
    mapApi
      .get()
      .then((response) => setMap(getMapFromResponse(response)))
      .catch(() => {});
  }

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

  function openLocation(locationId: LocationId) {
    setSelectedTable(null);
    setActiveLocationId(locationId);
    setStep('zone');
  }

  function goBack() {
    if (step === 'form') {
      setStep('zone');
      return;
    }

    if (step === 'zone' && activeLocationId !== 'hall') {
      setStep('waterfront');
      return;
    }

    if (step === 'waterfront' || step === 'zone') {
      setStep('entry');
      return;
    }

    setStep('entry');
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
      <div className="min-h-screen bg-neutral-950 px-4 py-6 text-white">
        <section className="mx-auto max-w-md rounded-[34px] border border-red-400/25 bg-red-950/40 p-6 text-center shadow-2xl">
          <h1 className="text-2xl font-semibold">Ресторан зачинений</h1>
          <p className="mt-3 text-neutral-300">{restaurant.closeMessage}</p>
        </section>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-950 px-3 py-4 text-white sm:px-6">
      <div className="mx-auto max-w-6xl space-y-4">
        {step !== 'entry' && (
          <button
            onClick={goBack}
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-neutral-200 active:scale-95"
          >
            <ArrowLeft className="h-4 w-4" />
            Назад
          </button>
        )}

        {step === 'entry' && (
          <section className="overflow-hidden rounded-[34px] border border-white/10 bg-neutral-900 shadow-2xl">
            <div
              className="relative min-h-[560px] bg-cover bg-center"
              style={{
                backgroundImage:
                  'linear-gradient(180deg, rgba(0,0,0,.08), rgba(0,0,0,.66)), url("/maps/territory-bg.png")',
              }}
            >
              <div className="absolute left-4 right-4 top-4 rounded-[28px] border border-white/15 bg-black/45 p-4 backdrop-blur-md sm:left-6 sm:right-6">
                <p className="text-sm uppercase tracking-[.28em] text-amber-200">MOLO</p>
                <h1 className="mt-1 text-3xl font-semibold">Оберіть напрямок</h1>
                <p className="mt-2 text-sm text-neutral-200">
                  Центральний вхід веде до ресторану. Боковий прохід — на набережну.
                </p>
              </div>

              <button
                onClick={() => openLocation('hall')}
                className="absolute left-[38%] top-[42%] flex min-h-28 w-[24%] items-center justify-center rounded-[28px] border-2 border-amber-200/90 bg-amber-400/20 px-3 text-center text-lg font-bold text-white shadow-[0_0_32px_rgba(251,191,36,.45)] backdrop-blur-[1px] active:scale-95"
              >
                Ресторан
              </button>

              <button
                onClick={() => setStep('waterfront')}
                className="absolute left-[4%] top-[46%] flex min-h-24 w-[28%] items-center justify-center rounded-[28px] border-2 border-emerald-200/90 bg-emerald-500/20 px-3 text-center text-lg font-bold text-white shadow-[0_0_32px_rgba(16,185,129,.45)] backdrop-blur-[1px] active:scale-95"
              >
                На набережну
              </button>
            </div>

            <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-3">
              <button
                onClick={() => openLocation('hall')}
                className="rounded-2xl border border-white/10 bg-white/5 px-5 py-4 font-semibold active:scale-[0.99]"
              >
                Ресторан
              </button>

              <button
                onClick={() => setStep('waterfront')}
                className="rounded-2xl border border-white/10 bg-white/5 px-5 py-4 font-semibold active:scale-[0.99]"
              >
                На набережну
              </button>

              <button
                onClick={callAdmin}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-5 py-4 font-semibold active:scale-[0.99]"
              >
                <Phone className="h-4 w-4" />
                Адміністратор
              </button>
            </div>
          </section>
        )}

        {step === 'waterfront' && (
          <section className="rounded-[34px] border border-white/10 bg-neutral-900 p-4 shadow-2xl sm:p-6">
            <p className="text-sm uppercase tracking-[.28em] text-amber-200">Набережна</p>
            <h1 className="mt-1 text-3xl font-semibold">Оберіть локацію</h1>
            <p className="mt-2 text-sm text-neutral-300">
              Натисніть на потрібну зону, щоб перейти до вибору столів.
            </p>

            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {WATERFRONT_LOCATIONS.map((location) => (
                <button
                  key={location.id}
                  onClick={() => openLocation(location.id)}
                  className="flex min-h-28 flex-col items-start justify-between rounded-[28px] border border-white/10 bg-white/5 p-4 text-left active:scale-[0.99]"
                >
                  <MapPin className="h-5 w-5 text-amber-200" />
                  <span className="text-lg font-semibold">{location.label}</span>
                </button>
              ))}
            </div>

            <button
              onClick={() => setStep('entry')}
              className="mt-4 w-full rounded-2xl border border-white/10 bg-white/5 px-5 py-4 font-semibold active:scale-[0.99]"
            >
              Загальний вид
            </button>
          </section>
        )}

        {step === 'zone' && (
          <section className="overflow-hidden rounded-[34px] border border-white/10 bg-neutral-900 shadow-2xl">
            <div className="flex flex-col gap-3 border-b border-white/10 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm uppercase tracking-[.28em] text-amber-200">Локація</p>
                <h1 className="text-3xl font-semibold">{activeLocation.label}</h1>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:flex">
                <button
                  onClick={refreshMap}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm"
                >
                  <RefreshCcw className="h-4 w-4" />
                  Оновити
                </button>

                <button
                  onClick={openMenu}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm"
                >
                  <Menu className="h-4 w-4" />
                  Меню
                </button>
              </div>
            </div>

            <div className="grid gap-3 border-b border-white/10 p-4 sm:grid-cols-3">
              <label className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm">
                <span className="flex items-center gap-2 text-neutral-300">
                  <CalendarDays className="h-4 w-4" />
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

              <label className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm">
                <span className="flex items-center gap-2 text-neutral-300">
                  <Clock className="h-4 w-4" />
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

              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm">
                <span className="text-neutral-300">Статуси</span>

                <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                  <span className="inline-flex items-center gap-2">
                    <span className="h-3 w-3 rounded border border-white/40 bg-white/20" />
                    Вільний
                  </span>

                  <span className="inline-flex items-center gap-2">
                    <span className="h-3 w-3 rounded bg-amber-300 shadow-[0_0_12px_rgba(251,191,36,.85)]" />
                    Обраний
                  </span>

                  <span className="inline-flex items-center gap-2">
                    <span className="h-3 w-3 rounded bg-amber-500 shadow-[0_0_10px_rgba(251,191,36,.45)]" />
                    Бронь
                  </span>

                  <span className="inline-flex items-center gap-2">
                    <span className="h-3 w-3 rounded bg-red-500 shadow-[0_0_10px_rgba(248,113,113,.45)]" />
                    Зайнятий
                  </span>

                  <span className="inline-flex items-center gap-2">
                    <span className="h-3 w-3 rounded bg-neutral-500" />
                    Закритий
                  </span>
                </div>
              </div>
            </div>

            {restaurant?.status === 'booking_closed' && (
              <div className="m-4 rounded-2xl border border-amber-300/30 bg-amber-500/10 p-4 text-sm text-amber-100">
                {restaurant.bookingClosedMessage}
              </div>
            )}

            <div className="p-3">
              <div
                className="relative mx-auto w-full overflow-hidden rounded-[30px] border border-white/10 bg-neutral-950 shadow-inner"
                style={{
                  maxWidth: currentMapWidth,
                  aspectRatio: `${currentMapWidth} / ${currentMapHeight}`,
                  backgroundImage: `linear-gradient(180deg, rgba(0,0,0,.04), rgba(0,0,0,.22)), url("${activeLocation.background}")`,
                  backgroundSize: '100% 100%',
                  backgroundPosition: 'center',
                  backgroundRepeat: 'no-repeat',
                }}
              >
                <div className="pointer-events-none absolute inset-0 flex items-end justify-center p-4">
                  <div className="rounded-2xl border border-white/10 bg-black/50 px-4 py-2 text-xs text-neutral-200 backdrop-blur-md">
                    {activeLocation.fallbackText}
                  </div>
                </div>

                {locationTables.map((table) => {
                  const status = normalizeTableStatus(table.status);
                  const isSelected = selectedTable?.id === table.id;
                  const isBlocked =
                    restaurant?.status === 'booking_closed' ||
                    status !== 'free' ||
                    table.zone?.isClosed;

                  return (
                    <button
                      key={table.id}
                      onClick={() => selectTable(table)}
                      className={`absolute z-10 flex items-center justify-center border-2 text-sm font-black text-white transition active:scale-95 ${
                        table.shape === 'round' ? 'rounded-full' : 'rounded-2xl'
                      } ${tableClasses(table, isSelected)}`}
                      style={tableStyle(table, currentMapWidth, currentMapHeight)}
                      title={STATUS_TEXT[status]}
                    >
                      <span className="rounded-lg bg-black/35 px-2 py-1">
                        {isBlocked && status === 'closed' ? '✕ ' : ''}
                        {table.tableNumber}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {selectedTable && (
              <div className="border-t border-white/10 p-4">
                <button
                  onClick={continueWithSelectedTable}
                  className="w-full rounded-2xl border border-amber-200/80 bg-amber-300/10 px-5 py-4 font-semibold text-amber-100 shadow-[0_0_24px_rgba(251,191,36,.22)] active:scale-[0.99]"
                >
                  Продовжити зі столом №{selectedTable.tableNumber}
                </button>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2 border-t border-white/10 p-4 sm:grid-cols-4">
              <button
                onClick={() => {
                  setSelectedTable(null);
                  setStep('entry');
                }}
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm"
              >
                Загальний вид
              </button>

              <button
                onClick={() => openLocation('hall')}
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm"
              >
                Зал
              </button>

              <button
                onClick={() => {
                  setSelectedTable(null);
                  setStep('waterfront');
                }}
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm"
              >
                Набережна
              </button>

              <button
                onClick={callAdmin}
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm"
              >
                Дзвінок
              </button>
            </div>
          </section>
        )}

        {step === 'form' && selectedTable && (
          <section className="rounded-[34px] border border-white/10 bg-neutral-900 p-5 shadow-2xl sm:p-6">
            <h1 className="text-3xl font-semibold">{tableLabel(selectedTable)}</h1>

            <p className="mt-2 text-neutral-300">
              До {selectedTable.seats} гостей · {date} · {time}
            </p>

            <div className="mt-6 space-y-3">
              <input
                placeholder="Імʼя"
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

              <label className="block rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-neutral-300">
                <span className="flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  Кількість гостей
                </span>

                <input
                  type="number"
                  min={1}
                  max={50}
                  value={form.guestsCount}
                  onChange={(event) =>
                    setForm({ ...form, guestsCount: Number(event.target.value) })
                  }
                  className="mt-2 w-full bg-transparent text-white outline-none"
                />
              </label>

              <textarea
                placeholder="Побажання"
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
          <section className="rounded-[34px] border border-emerald-400/25 bg-emerald-950/40 p-6 text-center shadow-2xl">
            <CheckCircle2 className="mx-auto mb-4 h-12 w-12 text-emerald-400" />

            <h1 className="text-2xl font-semibold">Заявку надіслано</h1>

            <p className="mt-3 text-neutral-300">
              Адміністратор отримає заявку та підтвердить бронювання.
            </p>

            <button
              onClick={() => {
                setSelectedTable(null);
                setStep('entry');
              }}
              className="mt-6 w-full rounded-2xl border border-amber-200/80 bg-amber-300/10 px-5 py-4 font-semibold text-amber-100"
            >
              На головну
            </button>
          </section>
        )}
      </div>
    </div>
  );
}
