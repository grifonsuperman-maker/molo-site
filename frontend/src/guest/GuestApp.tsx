import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Clock,
  MapPin,
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

type TableStatus = 'free' | 'reserved' | 'occupied' | 'closed';

type WaterfrontLocation = {
  key: string;
  label: string;
  description: string;
};

const WATERFRONT_LOCATIONS: WaterfrontLocation[] = [
  {
    key: 'canopy',
    label: 'Навіс',
    description: 'Зона навісу. Фон локації додамо окремо.',
  },
  {
    key: 'gazebo',
    label: 'Велика бесідка',
    description: 'Окрема зона великої бесідки.',
  },
  {
    key: 'rotang',
    label: 'Ротанг',
    description: 'Зона з ротанговими місцями.',
  },
  {
    key: 'embankment',
    label: 'Набережна',
    description: 'Загальна зона набережної.',
  },
  {
    key: 'pier',
    label: 'Причал',
    description: 'Місця біля причалу.',
  },
  {
    key: 'water_pier',
    label: 'Причал на воді',
    description: 'Місця на воді.',
  },
];

const STATUS_TEXT: Record<TableStatus, string> = {
  free: 'Вільний',
  reserved: 'Заброньований',
  occupied: 'Зайнятий',
  closed: 'Закритий',
};

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

function tableButtonClass(table: TableItem) {
  const status = normalizeTableStatus(table.status);

  if (status === 'reserved') {
    return 'border-red-300 bg-red-500/20 text-red-100 shadow-[0_0_24px_rgba(239,68,68,.18)]';
  }

  if (status === 'occupied') {
    return 'border-amber-300 bg-amber-500/20 text-amber-100 shadow-[0_0_24px_rgba(245,158,11,.18)]';
  }

  if (status === 'closed') {
    return 'border-neutral-400 bg-neutral-500/20 text-neutral-200 shadow-[0_0_18px_rgba(115,115,115,.18)]';
  }

  return 'border-emerald-300 bg-emerald-500/20 text-emerald-100 shadow-[0_0_24px_rgba(16,185,129,.18)]';
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
      className="rounded-[26px] border border-amber-200/95 bg-black/10 px-6 py-5 text-xl font-semibold text-amber-100 shadow-[0_0_34px_rgba(251,191,36,.16)] backdrop-blur-sm transition active:scale-[0.99] disabled:opacity-50 sm:text-2xl"
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

  function openWaterfrontLocation(location: WaterfrontLocation) {
    setSelectedWaterfrontLocation(location);
    setStep('location_placeholder');
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
      <div className="flex min-h-[100dvh] items-center justify-center bg-black px-4 text-white">
        <section className="rounded-[34px] border border-white/10 bg-white/5 p-6 text-center shadow-2xl backdrop-blur-xl">
          <h1 className="text-2xl font-semibold">Ресторан зачинений</h1>
          <p className="mt-3 text-neutral-300">{restaurant.closeMessage}</p>
        </section>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-black text-white">
      {step !== 'home' && (
        <div className="fixed left-4 top-4 z-[80]">
          <button
            onClick={goBack}
            className="inline-flex items-center gap-2 rounded-full border border-amber-200/70 bg-black/30 px-4 py-2 text-sm text-amber-100 shadow-xl backdrop-blur-md active:scale-95"
          >
            <ArrowLeft className="h-4 w-4" />
            Назад
          </button>
        </div>
      )}

      {step === 'home' && (
        <section className="fixed inset-0 z-40 h-[100dvh] w-screen overflow-hidden bg-black">
          <img
            src="/hero-bg.jpg"
            alt="MOLO"
            className="absolute inset-0 h-full w-full object-cover opacity-85"
            draggable={false}
          />

          <div className="absolute inset-0 bg-gradient-to-b from-black/25 via-black/25 to-black/80" />

          <div className="relative flex h-[100dvh] w-full flex-col items-center justify-center px-4 pb-[112px] pt-6 text-center">
            <img
              src="/logo.png"
              alt="MOLO"
              className="mx-auto h-64 w-64 object-contain mix-blend-screen sm:h-80 sm:w-80"
              draggable={false}
            />

            <p className="mt-2 text-sm uppercase tracking-[0.55em] text-amber-100/75">
              Restaurant
            </p>

            <h1 className="mt-3 text-6xl font-light tracking-[0.24em] text-white sm:text-7xl">
              MOLO
            </h1>

            <p className="mt-6 max-w-2xl text-xl leading-snug text-white/90 sm:text-3xl">
              Бронювання столиків, меню та звʼязок з адміністратором.
            </p>

            <div className="mt-8 grid w-full max-w-2xl gap-4">
              <GoldButton onClick={() => setStep('location_choice')}>
                Забронювати столик
              </GoldButton>

              <button
                onClick={openMenu}
                className="inline-flex items-center justify-center gap-4 rounded-[26px] border border-amber-200/95 bg-black/10 px-6 py-5 text-xl font-semibold text-amber-100 shadow-[0_0_34px_rgba(251,191,36,.12)] backdrop-blur-sm transition active:scale-[0.99] sm:text-2xl"
              >
                <Menu className="h-7 w-7 text-amber-200" />
                Меню
              </button>

              <button
                onClick={callAdmin}
                className="inline-flex items-center justify-center gap-4 rounded-[26px] border border-amber-200/95 bg-black/10 px-6 py-5 text-xl font-semibold text-amber-100 shadow-[0_0_34px_rgba(251,191,36,.12)] backdrop-blur-sm transition active:scale-[0.99] sm:text-2xl"
              >
                <Phone className="h-7 w-7 text-amber-200" />
                Зателефонувати адміністратору
              </button>
            </div>

            <p className="mt-6 text-base text-white/75 sm:text-xl">
              Ми працюємо з 10:00 до 23:00
            </p>
          </div>
        </section>
      )}

      {step === 'location_choice' && (
        <section className="fixed inset-0 z-40 h-[100dvh] w-screen overflow-hidden bg-black text-white">
          <img
            src="/maps/territory-bg.png"
            alt="Вхід до ресторану MOLO"
            className="absolute inset-0 h-full w-full object-cover opacity-95"
            draggable={false}
          />

          <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-black/20 to-black/85" />

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

          <div className="relative flex h-[100dvh] w-full items-end px-5 pb-[120px] pt-20 text-center">
            <div className="w-full">
              <p className="text-sm uppercase tracking-[0.45em] text-amber-100/80">
                MOLO
              </p>

              <h1 className="mx-auto mt-4 max-w-[680px] text-4xl font-black leading-tight text-white">
                Раді вітати вас у ресторані MOLO
              </h1>

              <p className="mx-auto mt-5 max-w-[620px] text-xl leading-snug text-white/90">
                Оберіть локацію, у якій бажаєте забронювати стіл
              </p>

              <div className="mx-auto mt-8 grid w-full max-w-[680px] gap-5">
                <button
                  onClick={() => setStep('hall_map')}
                  className="rounded-[28px] border border-amber-200/95 bg-black/10 px-6 py-6 text-2xl font-semibold text-amber-100 shadow-[0_0_34px_rgba(251,191,36,.14)] backdrop-blur-sm active:scale-[0.99]"
                >
                  Зал ресторану
                </button>

                <button
                  onClick={() => setStep('waterfront_choice')}
                  className="rounded-[28px] border border-amber-200/95 bg-black/10 px-6 py-6 text-2xl font-semibold text-amber-100 shadow-[0_0_34px_rgba(251,191,36,.14)] backdrop-blur-sm active:scale-[0.99]"
                >
                  Набережна ресторану
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      {step === 'waterfront_choice' && (
        <section className="min-h-[100dvh] bg-black px-4 py-20 pb-[120px] text-white">
          <div className="mx-auto max-w-5xl text-center">
            <p className="text-sm uppercase tracking-[0.28em] text-amber-100/75">
              Набережна ресторану
            </p>

            <h1 className="mt-3 text-4xl font-black tracking-tight">
              Оберіть локацію
            </h1>

            <p className="mx-auto mt-3 max-w-2xl text-white/75">
              Тут будуть зовнішні зони ресторану. Поки відкриваємо заглушки, а фони додамо окремо.
            </p>

            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {WATERFRONT_LOCATIONS.map((location) => (
                <button
                  key={location.key}
                  onClick={() => openWaterfrontLocation(location)}
                  className="rounded-[26px] border border-amber-200/70 bg-black/20 p-5 text-left text-amber-100 shadow-[0_0_24px_rgba(251,191,36,.1)] backdrop-blur-sm transition active:scale-[0.99]"
                >
                  <div className="flex items-start gap-3">
                    <span className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-amber-200/40 bg-amber-300/10">
                      <MapPin className="h-5 w-5" />
                    </span>

                    <span>
                      <span className="block text-lg font-semibold">
                        {location.label}
                      </span>

                      <span className="mt-1 block text-sm text-white/60">
                        {location.description}
                      </span>
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </section>
      )}

      {step === 'location_placeholder' && selectedWaterfrontLocation && (
        <section className="flex min-h-[100dvh] items-center justify-center bg-black px-4 py-20 pb-[120px] text-center text-white">
          <div className="w-full max-w-2xl rounded-[34px] border border-amber-200/40 bg-black/30 p-7 shadow-2xl backdrop-blur-md">
            <p className="text-sm uppercase tracking-[0.28em] text-amber-100/75">
              Локація
            </p>

            <h1 className="mt-3 text-4xl font-black tracking-tight">
              {selectedWaterfrontLocation.label}
            </h1>

            <p className="mx-auto mt-4 max-w-xl text-white/75">
              Фон цієї локації ще не додано. Після завантаження картинки сюди підключимо вибір столів.
            </p>

            <div className="mt-6 rounded-[30px] border border-dashed border-amber-200/30 bg-white/[0.03] p-8 text-amber-100/70">
              Очікується фон локації
            </div>
          </div>
        </section>
      )}

      {step === 'hall_map' && (
        <section className="min-h-[100dvh] bg-black px-4 py-20 pb-[120px] text-white">
          <div className="mx-auto max-w-6xl">
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
                className="rounded-full border border-amber-200/60 bg-black/20 px-4 py-2 text-sm text-amber-100 active:scale-95"
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
              <img
                src="/maps/hall-bg.png"
                alt="Зал ресторану"
                className="max-h-[68vh] w-full rounded-[24px] object-contain"
                draggable={false}
              />
            </div>

            <div className="mt-5 rounded-[28px] border border-amber-200/30 bg-black/30 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">Столи</h2>

                <div className="flex flex-wrap gap-2 text-[11px] text-white/65">
                  <span className="inline-flex items-center gap-1">
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                    Вільний
                  </span>

                  <span className="inline-flex items-center gap-1">
                    <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
                    Заброньований
                  </span>

                  <span className="inline-flex items-center gap-1">
                    <span className="h-2.5 w-2.5 rounded-full bg-neutral-500" />
                    Закритий
                  </span>
                </div>
              </div>

              {visibleTables.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-amber-200/30 bg-black/30 p-4 text-sm text-white/60">
                  Столи ще не додано. Додай столи в конструкторі, і вони зʼявляться тут.
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {visibleTables.map((table: TableItem) => {
                    const status = normalizeTableStatus(table.status);

                    const isBlocked =
                      restaurant?.status === 'booking_closed' ||
                      status !== 'free' ||
                      table.zone?.isClosed;

                    return (
                      <button
                        key={table.id}
                        onClick={() => selectTable(table)}
                        className={`rounded-2xl border px-4 py-4 text-left transition active:scale-[0.98] ${tableButtonClass(
                          table,
                        )}`}
                      >
                        <span className="block text-lg font-black">
                          Стіл {table.tableNumber}
                        </span>

                        <span className="mt-1 block text-sm opacity-80">
                          до {table.seats} гостей
                        </span>

                        <span className="mt-2 block text-xs font-semibold uppercase tracking-[0.15em] opacity-80">
                          {STATUS_TEXT[status]}
                        </span>

                        {isBlocked ? (
                          <span className="mt-2 block text-xs opacity-70">
                            Натисніть, щоб зателефонувати
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {step === 'form' && selectedTable && (
        <section className="flex min-h-[100dvh] items-center justify-center bg-black px-4 py-20 pb-[120px] text-white">
          <div className="w-full max-w-2xl rounded-[32px] border border-amber-200/35 bg-black/35 p-6 shadow-2xl backdrop-blur-md">
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
        <section className="flex min-h-[100dvh] items-center justify-center bg-black px-4 py-20 pb-[120px] text-center text-white">
          <div className="w-full max-w-2xl rounded-[32px] border border-emerald-400/25 bg-emerald-950/40 p-6 shadow-2xl backdrop-blur-xl">
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
