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

type HallSvgShape =
  | {
      number: number;
      seats: number;
      kind: 'polygon';
      points: string;
    }
  | {
      number: number;
      seats: number;
      kind: 'ellipse';
      cx: number;
      cy: number;
      rx: number;
      ry: number;
    };

const HALL_VIEWBOX_WIDTH = 1536;
const HALL_VIEWBOX_HEIGHT = 1152;

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

// Координаты из утверждённого технического превью:
// наружная сторона оранжевых точек + жирный неон.
const HALL_SVG_TABLES: HallSvgShape[] = [
  // 1–4
  {
    number: 1,
    seats: 4,
    kind: 'polygon',
    points: '234,730 363,752 331,814 200,790',
  },
  {
    number: 2,
    seats: 4,
    kind: 'polygon',
    points: '354,550 466,564 442,613 326,598',
  },
  {
    number: 3,
    seats: 4,
    kind: 'polygon',
    points: '461,350 559,358 538,399 438,390',
  },
  {
    number: 4,
    seats: 4,
    kind: 'polygon',
    points: '544,223 642,228 625,263 527,256',
  },

  // 5–10
  {
    number: 5,
    seats: 6,
    kind: 'ellipse',
    cx: 617,
    cy: 666,
    rx: 63,
    ry: 50,
  },
  {
    number: 6,
    seats: 6,
    kind: 'ellipse',
    cx: 689.5,
    cy: 455,
    rx: 56.5,
    ry: 40,
  },
  {
    number: 7,
    seats: 6,
    kind: 'ellipse',
    cx: 784,
    cy: 311,
    rx: 53,
    ry: 37,
  },
  {
    number: 8,
    seats: 6,
    kind: 'ellipse',
    cx: 802,
    cy: 825.5,
    rx: 75,
    ry: 61.5,
  },
  {
    number: 9,
    seats: 6,
    kind: 'ellipse',
    cx: 866,
    cy: 564,
    rx: 65,
    ry: 45,
  },
  {
    number: 10,
    seats: 6,
    kind: 'ellipse',
    cx: 943.5,
    cy: 390.5,
    rx: 57.5,
    ry: 38.5,
  },

  // 11–14
  {
    number: 11,
    seats: 4,
    kind: 'polygon',
    points: '1142,409 1223,411 1225,453 1142,450',
  },
  {
    number: 12,
    seats: 4,
    kind: 'polygon',
    points: '1140,344 1220,344 1220,390 1140,384',
  },
  {
    number: 13,
    seats: 4,
    kind: 'polygon',
    points: '1138,285 1215,285 1215,326 1137,322',
  },
  {
    number: 14,
    seats: 4,
    kind: 'polygon',
    points: '1134,230 1211,230 1211,267 1134,263',
  },
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

function createFallbackTable(tableNumber: number, seats: number): TableItem {
  return {
    id: `hall-visual-${tableNumber}`,
    tableNumber,
    seats,
    status: 'free',
    isVisible: true,
  } as unknown as TableItem;
}

function getTableNeonColor(status: TableStatus, active: boolean) {
  if (active) return '#facc15';

  if (status === 'pending') return '#38bdf8';
  if (status === 'reserved') return '#fb923c';
  if (status === 'occupied') return '#ff3b4f';
  if (status === 'closed') return '#bdbdbd';

  return '#ffffff';
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

  function getVisualTableStatus(tableNumber: number): TableStatus {
    const realTable = findRealTableByNumber(tableNumber);
    if (realTable?.zone?.isClosed) return 'closed';
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

  function selectSvgHallTable(svgTable: HallSvgShape) {
    const realTable = findRealTableByNumber(svgTable.number);
    const table = realTable ?? createFallbackTable(svgTable.number, svgTable.seats);
    const status = normalizeTableStatus(table.status);

    setActiveTableNumber(svgTable.number);

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
        'Цей стіл ще не привʼязаний до базы. Столи 1–14 потрібно один раз додати в базу, потім бронювання запрацює повністю.',
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
            from { opacity: 0; transform: translateY(10px) scale(0.985); filter: blur(5px); }
            to { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }
          }

          @keyframes moloPanelUp {
            from { opacity: 0; transform: translateY(28px) scale(0.98); filter: blur(6px); }
            to { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }
          }

          @keyframes moloBgZoom {
            from { opacity: 0.72; transform: scale(1.015); }
            to { opacity: 1; transform: scale(1); }
          }

          @keyframes moloLogoPop {
            from { opacity: 0; transform: translateY(-10px) scale(0.9); filter: blur(5px); }
            to { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }
          }

          .molo-screen { animation: moloFadeIn 420ms ease-out both; }
          .molo-panel { animation: moloPanelUp 520ms cubic-bezier(0.16, 1, 0.3, 1) both; }
          .molo-bg { animation: moloBgZoom 900ms ease-out both; transform-origin: center; }
          .molo-logo { animation: moloLogoPop 650ms cubic-bezier(0.16, 1, 0.3, 1) both; }

          .molo-button {
            transition: transform 180ms ease, border-color 180ms ease, box-shadow 180ms ease, background 180ms ease, opacity 180ms ease;
          }
          .molo-button:active { transform: scale(0.96); }
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
                  Menu
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

                <svg
                  className="absolute inset-0 z-50 h-full w-full"
                  viewBox={`0 0 ${HALL_VIEWBOX_WIDTH} ${HALL_VIEWBOX_HEIGHT}`}
                  preserveAspectRatio="xMidYMid meet"
                >
                  {HALL_SVG_TABLES.map((svgTable) => {
                    const status = getVisualTableStatus(svgTable.number);
                    const isActive = activeTableNumber === svgTable.number;
                    const color = getTableNeonColor(status, isActive);

                    const shouldShowVisibleNeon = isActive || status !== 'free';

                    const neonStyle = {
                      filter: `
                        drop-shadow(0 0 6px ${color})
                        drop-shadow(0 0 14px ${color})
                        drop-shadow(0 0 26px ${color})
                      `,
                      transition: 'all 180ms ease',
                    };

                    const handleClick = () => selectSvgHallTable(svgTable);

                    return (
                      <g
                        key={`hall-svg-table-${svgTable.number}`}
                        role="button"
                        tabIndex={0}
                        aria-label={`Стіл ${svgTable.number}`}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            selectSvgHallTable(svgTable);
                          }
                        }}
                      >
                        {svgTable.kind === 'polygon' ? (
                          <>
                            <polygon
                              points={svgTable.points}
                              fill="transparent"
                              stroke="transparent"
                              strokeWidth={40}
                              cursor="pointer"
                              pointerEvents="all"
                              onClick={handleClick}
                            />

                            {shouldShowVisibleNeon && (
                              <>
                                <polygon
                                  points={svgTable.points}
                                  fill={color}
                                  fillOpacity={isActive ? 0.14 : 0.08}
                                  stroke={color}
                                  strokeWidth={22}
                                  strokeOpacity={0.28}
                                  strokeLinejoin="round"
                                  style={neonStyle}
                                  cursor="pointer"
                                  pointerEvents="none"
                                />

                                <polygon
                                  points={svgTable.points}
                                  fill="transparent"
                                  stroke={color}
                                  strokeWidth={13}
                                  strokeOpacity={0.78}
                                  strokeLinejoin="round"
                                  style={neonStyle}
                                  cursor="pointer"
                                  pointerEvents="none"
                                />

                                <polygon
                                  points={svgTable.points}
                                  fill="transparent"
                                  stroke={color}
                                  strokeWidth={6}
                                  strokeOpacity={1}
                                  strokeLinejoin="round"
                                  style={neonStyle}
                                  cursor="pointer"
                                  pointerEvents="none"
                                />

                                <polygon
                                  points={svgTable.points}
                                  fill="transparent"
                                  stroke="white"
                                  strokeWidth={2}
                                  strokeOpacity={0.65}
                                  strokeLinejoin="round"
                                  cursor="pointer"
                                  pointerEvents="none"
                                />
                              </>
                            )}
                          </>
                        ) : (
                          <>
                            <ellipse
                              cx={svgTable.cx}
                              cy={svgTable.cy}
                              rx={svgTable.rx}
                              ry={svgTable.ry}
                              fill="transparent"
                              stroke="transparent"
                              strokeWidth={40}
                              cursor="pointer"
                              pointerEvents="all"
                              onClick={handleClick}
                            />

                            {shouldShowVisibleNeon && (
                              <>
                                <ellipse
                                  cx={svgTable.cx}
                                  cy={svgTable.cy}
                                  rx={svgTable.rx}
                                  ry={svgTable.ry}
                                  fill={color}
                                  fillOpacity={isActive ? 0.14 : 0.08}
                                  stroke={color}
                                  strokeWidth={22}
                                  strokeOpacity={0.28}
                                  style={neonStyle}
                                  cursor="pointer"
                                  pointerEvents="none"
                                />

                                <ellipse
                                  cx={svgTable.cx}
                                  cy={svgTable.cy}
                                  rx={svgTable.rx}
                                  ry={svgTable.ry}
                                  fill="transparent"
                                  stroke={color}
                                  strokeWidth={13}
                                  strokeOpacity={0.78}
                                  style={neonStyle}
                                  cursor="pointer"
                                  pointerEvents="none"
                                />

                                <ellipse
                                  cx={svgTable.cx}
                                  cy={svgTable.cy}
                                  rx={svgTable.rx}
                                  ry={svgTable.ry}
                                  fill="transparent"
                                  stroke={color}
                                  strokeWidth={6}
                                  strokeOpacity={1}
                                  style={neonStyle}
                                  cursor="pointer"
                                  pointerEvents="none"
                                />

                                <ellipse
                                  cx={svgTable.cx}
                                  cy={svgTable.cy}
                                  rx={svgTable.rx}
                                  ry={svgTable.ry}
                                  fill="transparent"
                                  stroke="white"
                                  strokeWidth={2}
                                  strokeOpacity={0.65}
                                  cursor="pointer"
                                  pointerEvents="none"
                                />
                              </>
                            )}
                          </>
                        )}
                      </g>
                    );
                  })}
                </svg>
              </div>
            </div>

            <div className="mt-5 rounded-[28px] border border-amber-200/30 bg-black/30 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">Статуси столів</h2>

                <div className="flex flex-wrap gap-2 text-[11px] text-white/65">
                  <span className="inline-flex items-center gap-1">
                    <span className="h-2.5 w-2.5 rounded-full bg-white border border-neutral-400" />
                    Вільний
                  </span>

                  <span className="inline-flex items-center gap-1">
                    <span className="h-2.5 w-2.5 rounded-full bg-blue-500" />
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
