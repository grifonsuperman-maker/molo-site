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
  clickW: number;
  clickH: number;
  glowW: number;
  glowH: number;
  shape: 'round' | 'rect';
};

const WATERFRONT_LOCATIONS: WaterfrontLocation[] = [
  {
    key: 'canopy',
    label: 'Навіс',
    description: 'Зона навісу',
    background: '/maps/canopy-day-numbered.png',
  },
  {
    key: 'gazebo',
    label: 'Велика альтанка',
    description: 'Окрема зона великої альтанки',
    background: '/maps/gazebo-day-numbered.png',
  },
  {
    key: 'rotang',
    label: 'Ротанг',
    description: 'Зона з ротанговими місцями',
    background: '/maps/rotang-day-numbered.png',
  },
  {
    key: 'embankment',
    label: 'Набережна',
    description: 'Загальна зона набережної',
    background: '/maps/embankment-day-numbered.png',
  },
  {
    key: 'glass_gazebo',
    label: 'Скляна альтанка',
    description: 'Зона скляної альтанки',
    background: '/maps/glass-gazebo-day-numbered.png',
  },
  {
    key: 'water_gazebo',
    label: 'Альтанка на воді',
    description: 'Зона альтанки на воді',
    background: '/maps/water-gazebo-day-numbered.png',
  },
];

const HALL_VISUAL_TABLES: VisualHallTable[] = [
  { number: 1, seats: 4, x: 18.4, y: 67.5, clickW: 12, clickH: 9, glowW: 74, glowH: 58, shape: 'rect' },
  { number: 2, seats: 4, x: 25.9, y: 52.0, clickW: 12, clickH: 9, glowW: 74, glowH: 58, shape: 'rect' },

  // Столы 3 и 4 чуть сдвинуты выше и левее
  { number: 3, seats: 4, x: 32.0, y: 36.7, clickW: 12, clickH: 9, glowW: 74, glowH: 58, shape: 'rect' },
  { number: 4, seats: 4, x: 37.3, y: 23.8, clickW: 12, clickH: 9, glowW: 74, glowH: 58, shape: 'rect' },

  { number: 5, seats: 6, x: 39.6, y: 59.0, clickW: 13, clickH: 11, glowW: 82, glowH: 72, shape: 'round' },
  { number: 6, seats: 6, x: 44.7, y: 45.1, clickW: 13, clickH: 11, glowW: 82, glowH: 72, shape: 'round' },
  { number: 7, seats: 6, x: 50.8, y: 29.4, clickW: 13, clickH: 11, glowW: 82, glowH: 72, shape: 'round' },
  { number: 8, seats: 6, x: 52.1, y: 71.5, clickW: 14, clickH: 12, glowW: 82, glowH: 72, shape: 'round' },
  { number: 9, seats: 6, x: 57.0, y: 50.5, clickW: 13, clickH: 11, glowW: 82, glowH: 72, shape: 'round' },
  { number: 10, seats: 6, x: 62.0, y: 35.4, clickW: 13, clickH: 11, glowW: 82, glowH: 72, shape: 'round' },

  { number: 11, seats: 4, x: 77.7, y: 37.0, clickW: 10, clickH: 7, glowW: 80, glowH: 64, shape: 'rect' },
  { number: 12, seats: 4, x: 77.8, y: 31.0, clickW: 10, clickH: 7, glowW: 80, glowH: 64, shape: 'rect' },
  { number: 13, seats: 4, x: 77.9, y: 25.2, clickW: 10, clickH: 7, glowW: 80, glowH: 64, shape: 'rect' },
  { number: 14, seats: 4, x: 78.0, y: 19.5, clickW: 10, clickH: 7, glowW: 80, glowH: 64, shape: 'rect' },
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

function tableHighlightClass(status: TableStatus, active: boolean) {
  if (active) {
    return 'bg-amber-300/45 ring-2 ring-amber-100/95 shadow-[0_0_34px_rgba(251,191,36,.95)]';
  }

  if (status === 'pending') {
    return 'bg-blue-600/35 ring-2 ring-blue-300/85 shadow-[0_0_28px_rgba(37,99,235,.85)]';
  }

  if (status === 'reserved') {
    return 'bg-orange-500/35 ring-2 ring-orange-200/85 shadow-[0_0_28px_rgba(249,115,22,.85)]';
  }

  if (status === 'occupied') {
    return 'bg-red-600/38 ring-2 ring-red-200/90 shadow-[0_0_30px_rgba(239,68,68,.9)]';
  }

  if (status === 'closed') {
    return 'bg-neutral-500/35 ring-2 ring-neutral-300/75 shadow-[0_0_22px_rgba(115,115,115,.8)]';
  }

  return 'bg-emerald-400/0 ring-0 shadow-none';
}

function tableHighlightOpacityClass(status: TableStatus, active: boolean) {
  if (active) return 'opacity-100';
  if (status === 'free') return 'opacity-0';
  return 'opacity-100';
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
  const [activeTableNumber, setActiveTableNumber] = useState<number | null>(null);

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
    setActiveTableNumber(null);

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
      alert(`Стіл недоступний: ${STATUS_TEXT[status]}`);
      return;
    }

    setSelectedTable(table);
    setStep('form');
  }

  function selectVisualHallTable(visualTable: VisualHallTable) {
    const realTable = findRealTableByNumber(visualTable.number);
    const table = realTable ?? createFallbackTable(visualTable);
    const status = normalizeTableStatus(table.status);

    setActiveTableNumber(visualTable.number);

    if (restaurant?.status === 'booking_closed' || status !== 'free' || table.zone?.isClosed) {
      window.setTimeout(() => {
        alert(`Стіл недоступний: ${STATUS_TEXT[status]}`);
      }, 220);
      return;
    }

    window.setTimeout(() => {
      selectTable(table);
    }, 650);
  }

  function openWaterfrontLocation(location: WaterfrontLocation) {
    setSelectedWaterfrontLocation(location);
    setStep('location_placeholder');
  }

  async function submit() {
    if (!selectedTable) return;

    if (String(selectedTable.id).startsWith('hall-visual-')) {
      alert(
        'Цей стіл ще не привʼязаний до бази. Столи 1–14 потрібно один раз додати в базу, потім бронювання запрацює повністю.',
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

          @keyframes tableSpring {
            0% {
              transform: scale(0.55);
              opacity: 0;
            }
            48% {
              transform: scale(1.22);
              opacity: 1;
            }
            72% {
              transform: scale(0.92);
              opacity: 1;
            }
            100% {
              transform: scale(1);
              opacity: 1;
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
            transform: scale(0.96);
          }

          .molo-button:hover {
            border-color: rgba(253, 230, 138, 1);
            box-shadow: 0 0 42px rgba(251, 191, 36, 0.2);
            background: rgba(0, 0, 0, 0.18);
          }

          .hall-table-highlight {
            transition:
              opacity 180ms ease,
              transform 180ms ease,
              box-shadow 180ms ease,
              background 180ms ease;
            transform-origin: center;
          }

          .hall-table-highlight-active {
            animation: tableSpring 420ms cubic-bezier(0.18, 1.65, 0.35, 1) both;
          }

          .hall-click:active .hall-table-highlight {
            transform: scale(0.9);
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
        <section className="molo-screen min-h-[100dvh] bg-black px-4 py-20 pb-[120px] text-white">
          <div className="molo-panel mx-auto max-w-6xl">
            <div className="mb-4">
              <p className="text-sm uppercase tracking-[0.28em] text-amber-100/75">
                Локація
              </p>

              <h1 className="mt-2 text-4xl font-black tracking-tight">
                {selectedWaterfrontLocation.label}
              </h1>

              <p className="mt-2 text-white/70">
                {selectedWaterfrontLocation.description}
              </p>
            </div>

            <div className="overflow-hidden rounded-[30px] border border-amber-200/30 bg-black/60 p-2">
              <div className="relative mx-auto w-full overflow-hidden rounded-[24px]">
                <img
                  src={selectedWaterfrontLocation.background}
                  alt={selectedWaterfrontLocation.label}
                  className="w-full rounded-[24px] object-contain"
                  draggable={false}
                />
              </div>
            </div>

            <div className="mt-5 rounded-[28px] border border-amber-200/30 bg-black/30 p-4 text-center">
              <p className="text-lg font-semibold text-amber-100">
                Вибір столів цієї зони скоро буде підключено
              </p>

              <p className="mx-auto mt-2 max-w-2xl text-sm text-white/65">
                Фото з номерами вже підключено. Наступний крок — додати невидимі
                зони кліку для столів цієї локації.
              </p>

              <button
                onClick={callAdmin}
                className="molo-button mt-4 inline-flex items-center justify-center gap-3 rounded-[22px] border border-amber-200/80 bg-black/20 px-5 py-3 text-sm font-semibold text-amber-100"
              >
                <Phone className="h-4 w-4 text-amber-200" />
                Забронювати через адміністратора
              </button>
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
                  src="/maps/hall-bg-numbered.png"
                  alt="Зал ресторану"
                  className="w-full rounded-[24px] object-contain"
                  draggable={false}
                />

                {HALL_VISUAL_TABLES.map((visualTable) => {
                  const status = getVisualTableStatus(visualTable);
                  const isActive = activeTableNumber === visualTable.number;

                  return (
                    <button
                      key={visualTable.number}
                      onClick={() => selectVisualHallTable(visualTable)}
                      className="hall-click group absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center bg-transparent"
                      style={{
                        left: `${visualTable.x}%`,
                        top: `${visualTable.y}%`,
                        width: `${visualTable.clickW}%`,
                        height: `${visualTable.clickH}%`,
                      }}
                      title={`Стіл ${visualTable.number}`}
                      aria-label={`Стіл ${visualTable.number}`}
                    >
                      <span
                        className={`hall-table-highlight pointer-events-none blur-[1px] ${tableHighlightClass(
                          status,
                          isActive,
                        )} ${tableHighlightOpacityClass(status, isActive)} ${
                          isActive ? 'hall-table-highlight-active' : ''
                        }`}
                        style={{
                          width: `${visualTable.glowW}%`,
                          height: `${visualTable.glowH}%`,
                          borderRadius: visualTable.shape === 'round' ? '999px' : '16px',
                        }}
                      />
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
                    <span className="h-2.5 w-2.5 rounded-full bg-blue-600" />
                    Очікує
                  </span>

                  <span className="inline-flex items-center gap-1">
                    <span className="h-2.5 w-2.5 rounded-full bg-orange-500" />
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
                Натисніть на номер столу прямо на фото залу.
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
