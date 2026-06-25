import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Clock,
  Menu,
  Phone,
  Users,
} from 'lucide-react';

import type { FullMapResponse, Restaurant, TableItem } from '../api/types';
import { bookingsApi } from '../api/bookings';
import { mapApi } from '../api/map';
import { restaurantApi } from '../api/restaurant';
import { useAsyncAction } from '../hooks/useAsyncAction';

const FALLBACK_MENU =
  'https://expz.menu/8ec3f3d4-0e9f-4ed7-a03f-5f4deaba843e?utm_source=ig&utm_medium=social&utm_content=link_in_bio';

type Step =
  | 'home'
  | 'location_choice'
  | 'hall_map'
  | 'waterfront_choice'
  | 'location_placeholder'
  | 'form'
  | 'success';

type TableStatus = 'free' | 'pending' | 'reserved' | 'occupied' | 'closed';

type WaterfrontLocation = {
  key: string;
  label: string;
  description: string;
  background: string;
};

type VisualHallTable = {
  number: number;
  seats: number;
  x: number;
  y: number;
};

const WATERFRONT_LOCATIONS: WaterfrontLocation[] = [
  {
    key: 'canopy',
    label: 'Навіс',
    description: 'Зона навісу',
    background: '/maps/canopy-day-bg.png',
  },
  {
    key: 'gazebo',
    label: 'Велика альтанка',
    description: 'Окрема зона великої альтанки',
    background: '/maps/gazebo-day-bg.png',
  },
  {
    key: 'rotang',
    label: 'Ротанг',
    description: 'Зона з ротанговими місцями',
    background: '/maps/rotang-day-bg.png',
  },
  {
    key: 'embankment',
    label: 'Набережна',
    description: 'Загальна зона набережної',
    background: '/maps/embankment-day-bg.png',
  },
  {
    key: 'glass_gazebo',
    label: 'Скляна альтанка',
    description: 'Зона скляної альтанки',
    background: '/maps/glass-gazebo-day-bg.png',
  },
  {
    key: 'water_gazebo',
    label: 'Альтанка на воді',
    description: 'Зона альтанки на воді',
    background: '/maps/water-gazebo-day-bg.png',
  },
];

const HALL_VISUAL_TABLES: VisualHallTable[] = [
  { number: 1, seats: 4, x: 15, y: 72 },
  { number: 2, seats: 4, x: 25, y: 58 },
  { number: 3, seats: 4, x: 32, y: 43 },
  { number: 4, seats: 4, x: 39, y: 25 },

  { number: 5, seats: 6, x: 42, y: 65 },
  { number: 6, seats: 6, x: 48, y: 49 },
  { number: 7, seats: 6, x: 54, y: 30 },
  { number: 8, seats: 6, x: 55, y: 78 },
  { number: 9, seats: 6, x: 61, y: 60 },
  { number: 10, seats: 6, x: 66, y: 43 },

  { number: 11, seats: 4, x: 82, y: 48 },
  { number: 12, seats: 4, x: 83, y: 39 },
  { number: 13, seats: 4, x: 84, y: 31 },
  { number: 14, seats: 4, x: 85, y: 23 },
];

const STATUS_TEXT: Record<TableStatus, string> = {
  free: 'Вільний',
  pending: 'Очікує підтвердження',
  reserved: 'Заброньований',
  occupied: 'Зайнятий',
  closed: 'Закритий',
};

function normalizeTableStatus(status: unknown): TableStatus {
  if (status === 'pending' || status === 'awaiting_confirmation') return 'pending';
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

function createFallbackTable(visualTable: VisualHallTable): TableItem {
  return {
    id: `hall-visual-${visualTable.number}`,
    tableNumber: visualTable.number,
    seats: visualTable.seats,
    status: 'free',
    isVisible: true,
  } as unknown as TableItem;
}

function tableButtonClassByStatus(status: TableStatus) {
  if (status === 'pending') {
    return 'border-sky-300 bg-sky-500/35 text-sky-50 shadow-[0_0_22px_rgba(56,189,248,.35)]';
  }

  if (status === 'reserved') {
    return 'border-amber-200 bg-amber-400/35 text-amber-50 shadow-[0_0_22px_rgba(251,191,36,.35)]';
  }

  if (status === 'occupied') {
    return 'border-red-300 bg-red-500/35 text-red-50 shadow-[0_0_22px_rgba(239,68,68,.35)]';
  }

  if (status === 'closed') {
    return 'border-neutral-300 bg-neutral-500/35 text-neutral-100 shadow-[0_0_18px_rgba(115,115,115,.28)]';
  }

  return 'border-emerald-300 bg-emerald-500/35 text-emerald-50 shadow-[0_0_22px_rgba(16,185,129,.35)]';
}

function GoldButton({
  children,
  onClick,
  disabled = false,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="molo-button rounded-[26px] border border-amber-200/95 bg-black/10 px-6 py-5 text-xl font-semibold text-amber-100 shadow-[0_0_34px_rgba(251,191,36,.16)] backdrop-blur-sm disabled:opacity-50 sm:text-2xl"
    >
      {children}
    </button>
  );
}

export default function GuestApp() {
  const [step, setStep] = useState<Step>('home');
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [map, setMap] = useState<FullMapResponse | null>(null);
  const [selectedTable, setSelectedTable] = useState<TableItem | null>(null);
  const [selectedWaterfrontLocation, setSelectedWaterfrontLocation] =
    useState<WaterfrontLocation | null>(null);

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

    refreshMap();
  }, []);

  const visibleTables = useMemo(() => {
    return (map?.tables || []).filter((table) => table.isVisible !== false);
  }, [map]);

  function refreshMap() {
    mapApi
      .get()
      .then((response) => setMap(getMapFromResponse(response)))
      .catch(() => {});
  }

  function findRealTableByNumber(tableNumber: number) {
    return visibleTables.find(
      (table) => Number(table.tableNumber) === Number(tableNumber),
    );
  }

  function getVisualTableStatus(visualTable: VisualHallTable): TableStatus {
    const realTable = findRealTableByNumber(visualTable.number);
    return normalizeTableStatus(realTable?.status);
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

  function goBack() {
    if (step === 'form') {
      setStep('hall_map');
      return;
    }

    if (step === 'hall_map' || step === 'waterfront_choice') {
      setStep('location_choice');
      return;
    }

    if (step === 'location_placeholder') {
      setStep('waterfront_choice');
      return;
    }

    if (step === 'location_choice') {
      setStep('home');
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
    setStep('form');
  }

  function selectVisualHallTable(visualTable: VisualHallTable) {
    const realTable = findRealTableByNumber(visualTable.number);
    const table = realTable ?? createFallbackTable(visualTable);
    selectTable(table);
  }

  function openWaterfrontLocation(location: WaterfrontLocation) {
    setSelectedWaterfrontLocation(location);
    setStep('location_placeholder');
  }

  async function submit() {
    if (!selectedTable) return;

    if (String(selectedTable.id).startsWith('hall-visual-')) {
      alert(
        'Цей стіл ще не привʼязаний до бази. Спочатку додай столи 1–14 у конструкторі або адмінці.',
      );
      return;
    }

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
      <div className="flex min-h-[100dvh] items-center justify-center bg-black px-4 text-white">
        <section className="molo-panel rounded-[34px] border border-white/10 bg-white/5 p-6 text-center shadow-2xl backdrop-blur-xl">
          <h1 className="text-2xl font-semibold">Ресторан зачинений</h1>
          <p className="mt-3 text-neutral-300">{restaurant.closeMessage}</p>
        </section>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-black text-white">
      <style>
        {`
          @keyframes moloFadeIn {
            from {
              opacity: 0;
              transform: translateY(10px) scale(0.985);
              filter: blur(5px);
            }
            to {
              opacity: 1;
              transform: translateY(0) scale(1);
              filter: blur(0);
            }
          }

          @keyframes moloPanelUp {
            from {
              opacity: 0;
              transform: translateY(28px) scale(0.98);
              filter: blur(6px);
            }
            to {
              opacity: 1;
              transform: translateY(0) scale(1);
              filter: blur(0);
            }
          }

          @keyframes moloBgZoom {
            from {
              opacity: 0.72;
              transform: scale(1.015);
            }
            to {
              opacity: 1;
              transform: scale(1);
            }
          }

          @keyframes moloLogoPop {
            from {
              opacity: 0;
              transform: translateY(-10px) scale(0.9);
              filter: blur(5px);
            }
            to {
              opacity: 1;
              transform: translateY(0) scale(1);
              filter: blur(0);
            }
          }

          .molo-screen {
            animation: moloFadeIn 420ms ease-out both;
          }

          .molo-panel {
            animation: moloPanelUp 520ms cubic-bezier(0.16, 1, 0.3, 1) both;
          }

          .molo-bg {
            animation: moloBgZoom 900ms ease-out both;
            transform-origin: center;
          }

          .molo-logo {
            animation: moloLogoPop 650ms cubic-bezier(0.16, 1, 0.3, 1) both;
          }

          .molo-button {
            transition:
              transform 180ms ease,
              border-color 180ms ease,
              box-shadow 180ms ease,
              background 180ms ease,
              opacity 180ms ease;
          }

          .molo-button:active {
            transform: scale(0.985);
          }

          .molo-button:hover {
            border-color: rgba(253, 230, 138, 1);
            box-shadow: 0 0 42px rgba(251, 191, 36, 0.2);
            background: rgba(0, 0, 0, 0.18);
          }
        `}
      </style>

      {step !== 'home' && (
        <div className="fixed left-4 top-4 z-[80]">
          <button
            onClick={goBack}
            className="molo-button inline-flex items-center gap-2 rounded-full border border-amber-200/70 bg-black/30 px-4 py-2 text-sm text-amber-100 shadow-xl backdrop-blur-md"
          >
            <ArrowLeft className="h-4 w-4" />
            Назад
          </button>
        </div>
      )}

      {step === 'home' && (
        <section className="molo-screen fixed inset-0 z-40 h-[100dvh] w-screen overflow-hidden bg-black">
          <img
            src="/hero-bg.jpg"
            alt="MOLO"
            className="molo-bg absolute inset-0 h-full w-full object-cover opacity-85"
            draggable={false}
          />

          <div className="absolute inset-0 bg-gradient-to-b from-black/25 via-black/25 to-black/80" />

          <div className="relative flex h-[100dvh] w-full flex-col items-center justify-center px-4 pb-[112px] pt-6 text-center">
            <img
              src="/logo.png"
              alt="MOLO"
              className="molo-logo mx-auto h-64 w-64 object-contain mix-blend-screen sm:h-80 sm:w-80"
              draggable={false}
            />

            <div className="molo-panel w-full">
              <p className="mt-2 text-sm uppercase tracking-[0.55em] text-amber-100/75">
                Restaurant
              </p>

              <h1 className="mt-3 text-6xl font-light tracking-[0.24em] text-white sm:text-7xl">
                MOLO
              </h1>

              <p className="mx-auto mt-6 max-w-2xl text-xl leading-snug text-white/90 sm:text-3xl">
                Бронювання столиків, меню та звʼязок з адміністратором.
              </p>

              <div className="mx-auto mt-8 grid w-full max-w-2xl gap-4">
                <GoldButton onClick={() => setStep('location_choice')}>
                  Забронювати столик
                </GoldButton>

                <button
                  onClick={openMenu}
                  className="molo-button inline-flex items-center justify-center gap-4 rounded-[26px] border border-amber-200/95 bg-black/10 px-6 py-5 text-xl font-semibold text-amber-100 shadow-[0_0_34px_rgba(251,191,36,.12)] backdrop-blur-sm sm:text-2xl"
                >
                  <Menu className="h-7 w-7 text-amber-200" />
                  Меню
                </button>

                <button
                  onClick={callAdmin}
                  className="molo-button inline-flex items-center justify-center gap-4 rounded-[26px] border border-amber-200/95 bg-black/10 px-6 py-5 text-xl font-semibold text-amber-100 shadow-[0_0_34px_rgba(251,191,36,.12)] backdrop-blur-sm sm:text-2xl"
                >
                  <Phone className="h-7 w-7 text-amber-200" />
                  Зателефонувати адміністратору
                </button>
              </div>

              <p className="mt-6 text-base text-white/75 sm:text-xl">
                Ми працюємо з 10:00 до 23:00
              </p>
            </div>
          </div>
        </section>
      )}

      {step === 'location_choice' && (
        <section className="molo-screen fixed inset-0 z-40 h-[100dvh] w-screen overflow-hidden bg-black text-white">
          <img
            src="/maps/territory-bg.png"
            alt="Вхід до ресторану MOLO"
            className="molo-bg absolute inset-0 h-full w-full object-cover opacity-95"
            draggable={false}
          />

          <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-black/10 to-black/80" />

          <button
            aria-label="Зал ресторану"
            onClick={() => setStep('hall_map')}
            className="absolute left-[38%] top-[23%] h-[42%] w-[34%] rounded-[32px] border border-amber-200/0 bg-amber-300/0 transition active:scale-[0.99]"
          />

          <button
            aria-label="Набережна ресторану"
            onClick={() => setStep('waterfront_choice')}
            className="absolute left-[0%] top-[25%] h-[44%] w-[36%] rounded-[32px] border border-amber-200/0 bg-amber-300/0 transition active:scale-[0.99]"
          />

          <div className="relative flex h-[100dvh] w-full items-end px-4 pb-[92px] pt-20 text-center">
            <div className="molo-panel w-full">
              <p className="text-xs uppercase tracking-[0.4em] text-amber-100/80">
                MOLO
              </p>

              <h1 className="mx-auto mt-3 max-w-[520px] text-2xl font-black leading-tight text-white sm:text-3xl">
                Раді вітати вас у ресторані MOLO
              </h1>

              <p className="mx-auto mt-3 max-w-[520px] text-sm leading-snug text-white/85 sm:text-base">
                Оберіть локацію, у якій бажаєте забронювати стіл
              </p>

              <div className="mx-auto mt-5 grid w-full max-w-[560px] gap-3">
                <button
                  onClick={() => setStep('hall_map')}
                  className="molo-button rounded-[24px] border border-amber-200/95 bg-black/10 px-5 py-4 text-lg font-semibold text-amber-100 shadow-[0_0_34px_rgba(251,191,36,.14)] backdrop-blur-sm sm:text-xl"
                >
                  Зал ресторану
                </button>

                <button
                  onClick={() => setStep('waterfront_choice')}
                  className="molo-button rounded-[24px] border border-amber-200/95 bg-black/10 px-5 py-4 text-lg font-semibold text-amber-100 shadow-[0_0_34px_rgba(251,191,36,.14)] backdrop-blur-sm sm:text-xl"
                >
                  Набережна ресторану
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      {step === 'waterfront_choice' && (
        <section className="molo-screen fixed inset-0 z-40 h-[100dvh] w-screen overflow-hidden bg-black text-white">
          <img
            src="/maps/waterfront-bg.png"
            alt="Набережна ресторану MOLO"
            className="molo-bg absolute inset-0 h-full w-full object-cover opacity-95"
            draggable={false}
          />

          <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-black/15 to-black/88" />

          <div className="relative flex h-[100dvh] w-full items-end px-4 pb-[92px] pt-20 text-center">
            <div className="molo-panel w-full">
              <p className="text-xs uppercase tracking-[0.4em] text-amber-100/80">
                Набережна ресторану
              </p>

              <h1 className="mx-auto mt-3 max-w-[520px] text-2xl font-black leading-tight text-white sm:text-3xl">
                Оберіть локацію на набережній
              </h1>

              <div className="mx-auto mt-5 grid w-full max-w-[680px] grid-cols-2 gap-3">
                {WATERFRONT_LOCATIONS.map((location) => (
                  <button
                    key={location.key}
                    onClick={() => openWaterfrontLocation(location)}
                    className="molo-button rounded-[22px] border border-amber-200/90 bg-black/10 px-4 py-4 text-base font-semibold text-amber-100 shadow-[0_0_28px_rgba(251,191,36,.12)] backdrop-blur-sm sm:text-lg"
                  >
                    {location.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {step === 'location_placeholder' && selectedWaterfrontLocation && (
        <section className="molo-screen fixed inset-0 z-40 h-[100dvh] w-screen overflow-hidden bg-black text-white">
          <div className="absolute inset-0 flex items-center justify-center bg-black">
            <img
              src={selectedWaterfrontLocation.background}
              alt={selectedWaterfrontLocation.label}
              className="molo-bg max-h-full max-w-full object-contain opacity-95"
              draggable={false}
            />
          </div>

          <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-black/5 to-black/80" />

          <div className="relative flex h-[100dvh] w-full items-end px-4 pb-[98px] pt-20 text-center">
            <div className="molo-panel w-full">
              <p className="text-xs uppercase tracking-[0.4em] text-amber-100/80">
                Локація
              </p>

              <h1 className="mx-auto mt-3 max-w-[620px] text-4xl font-black leading-tight text-white">
                {selectedWaterfrontLocation.label}
              </h1>

              <p className="mx-auto mt-3 max-w-[560px] text-base leading-snug text-white/85">
                {selectedWaterfrontLocation.description}
              </p>

              <div className="mx-auto mt-5 w-full max-w-[620px] rounded-[28px] border border-amber-200/70 bg-black/15 p-5 shadow-[0_0_34px_rgba(251,191,36,.12)] backdrop-blur-sm">
                <p className="text-lg font-semibold text-amber-100">
                  Вибір столів скоро буде підключено
                </p>

                <p className="mt-2 text-sm text-white/70">
                  Наступний крок — додати клікабельні столи цієї зони.
                </p>
              </div>
            </div>
          </div>
        </section>
      )}

      {step === 'hall_map' && (
        <section className="molo-screen min-h-[100dvh] bg-black px-4 py-20 pb-[120px] text-white">
          <div className="molo-panel mx-auto max-w-6xl">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-sm uppercase tracking-[0.28em] text-amber-100/75">
                  Зал ресторану
                </p>

                <h1 className="mt-2 text-4xl font-black tracking-tight">
                  Оберіть стіл
                </h1>

                <p className="mt-2 text-white/70">
                  Оберіть дату, час і вільний стіл.
                </p>
              </div>

              <button
                onClick={refreshMap}
                className="molo-button rounded-full border border-amber-200/60 bg-black/20 px-4 py-2 text-sm text-amber-100"
              >
                Оновити
              </button>
            </div>

            <div className="mb-4 grid gap-3 sm:grid-cols-2">
              <label className="rounded-2xl border border-amber-200/35 bg-black/20 px-4 py-3">
                <span className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-white/55">
                  <CalendarDays className="h-4 w-4" />
                  Дата
                </span>

                <input
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                  type="date"
                  className="mt-2 w-full bg-transparent text-sm outline-none"
                />
              </label>

              <label className="rounded-2xl border border-amber-200/35 bg-black/20 px-4 py-3">
                <span className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-white/55">
                  <Clock className="h-4 w-4" />
                  Час
                </span>

                <input
                  value={time}
                  onChange={(event) => setTime(event.target.value)}
                  type="time"
                  step="300"
                  className="mt-2 w-full bg-transparent text-sm outline-none"
                />
              </label>
            </div>

            {restaurant?.status === 'booking_closed' && (
              <div className="mb-4 rounded-2xl border border-amber-200/30 bg-amber-500/10 p-4 text-sm text-amber-100">
                {restaurant.bookingClosedMessage}
              </div>
            )}

            <div className="overflow-hidden rounded-[30px] border border-amber-200/30 bg-black/60 p-2">
              <div className="relative mx-auto w-full overflow-hidden rounded-[24px]">
                <img
                  src="/maps/hall-bg.png"
                  alt="Зал ресторану"
                  className="w-full rounded-[24px] object-contain"
                  draggable={false}
                />

                {HALL_VISUAL_TABLES.map((visualTable) => {
                  const status = getVisualTableStatus(visualTable);

                  return (
                    <button
                      key={visualTable.number}
                      onClick={() => selectVisualHallTable(visualTable)}
                      className={`molo-button absolute flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border text-sm font-black backdrop-blur-md sm:h-11 sm:w-11 sm:text-base ${tableButtonClassByStatus(
                        status,
                      )}`}
                      style={{
                        left: `${visualTable.x}%`,
                        top: `${visualTable.y}%`,
                      }}
                      title={`Стіл ${visualTable.number}`}
                    >
                      {visualTable.number}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-5 rounded-[28px] border border-amber-200/30 bg-black/30 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">Статуси столів</h2>

                <div className="flex flex-wrap gap-2 text-[11px] text-white/65">
                  <span className="inline-flex items-center gap-1">
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                    Вільний
                  </span>

                  <span className="inline-flex items-center gap-1">
                    <span className="h-2.5 w-2.5 rounded-full bg-sky-500" />
                    Очікує
                  </span>

                  <span className="inline-flex items-center gap-1">
                    <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                    Заброньований
                  </span>

                  <span className="inline-flex items-center gap-1">
                    <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
                    Зайнятий
                  </span>

                  <span className="inline-flex items-center gap-1">
                    <span className="h-2.5 w-2.5 rounded-full bg-neutral-500" />
                    Закритий
                  </span>
                </div>
              </div>

              <p className="rounded-2xl border border-dashed border-amber-200/30 bg-black/30 p-4 text-sm text-white/60">
                Натисніть на номер столу прямо на фото залу. Позиції можна буде трохи підправити після перевірки на телефоні.
              </p>
            </div>
          </div>
        </section>
      )}

      {step === 'form' && selectedTable && (
        <section className="molo-screen flex min-h-[100dvh] items-center justify-center bg-black px-4 py-20 pb-[120px] text-white">
          <div className="molo-panel w-full max-w-2xl rounded-[32px] border border-amber-200/35 bg-black/35 p-6 shadow-2xl backdrop-blur-md">
            <h1 className="text-2xl font-semibold">
              Стіл №{selectedTable.tableNumber}
            </h1>

            <p className="mt-2 text-white/70">
              до {selectedTable.seats} гостей · {date} · {time}
            </p>

            <div className="mt-6 grid gap-4">
              <input
                placeholder="Ваше імʼя"
                value={form.fullName}
                onChange={(event) => setForm({ ...form, fullName: event.target.value })}
                className="w-full rounded-2xl border border-amber-200/35 bg-white/5 px-4 py-3 outline-none"
              />

              <input
                placeholder="Телефон"
                value={form.phone}
                onChange={(event) => setForm({ ...form, phone: event.target.value })}
                className="w-full rounded-2xl border border-amber-200/35 bg-white/5 px-4 py-3 outline-none"
              />

              <label className="rounded-2xl border border-amber-200/35 bg-white/5 px-4 py-3">
                <span className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-white/55">
                  <Users className="h-4 w-4" />
                  Кількість гостей
                </span>

                <input
                  value={form.guestsCount}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      guestsCount: Number(event.target.value),
                    })
                  }
                  min={1}
                  type="number"
                  className="mt-2 w-full bg-transparent outline-none"
                />
              </label>

              <textarea
                placeholder="Побажання"
                value={form.wishes}
                onChange={(event) => setForm({ ...form, wishes: event.target.value })}
                className="min-h-24 w-full rounded-2xl border border-amber-200/35 bg-white/5 px-4 py-3 outline-none"
              />

              {error && <p className="text-sm text-red-300">{error}</p>}

              <GoldButton onClick={submit} disabled={loading}>
                {loading ? 'Надсилаємо...' : 'Надіслати заявку'}
              </GoldButton>
            </div>
          </div>
        </section>
      )}

      {step === 'success' && (
        <section className="molo-screen flex min-h-[100dvh] items-center justify-center bg-black px-4 py-20 pb-[120px] text-center text-white">
          <div className="molo-panel w-full max-w-2xl rounded-[32px] border border-emerald-400/25 bg-emerald-950/40 p-6 shadow-2xl backdrop-blur-xl">
            <CheckCircle2 className="mx-auto mb-4 h-12 w-12 text-emerald-400" />

            <h1 className="text-2xl font-semibold">Заявку надіслано</h1>

            <p className="mt-3 text-white/70">
              Адміністратор отримає заявку та підтвердить бронювання.
            </p>

            <div className="mt-6">
              <GoldButton onClick={() => setStep('home')}>
                На головну
              </GoldButton>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
