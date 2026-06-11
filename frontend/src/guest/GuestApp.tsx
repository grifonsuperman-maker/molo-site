import { useEffect, useMemo, useState } from 'react';
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

import type { FullMapResponse, MapObject, Restaurant, TableItem, Zone } from '../api/types';
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

function tableColor(table: TableItem) {
  const status = normalizeTableStatus(table.status);

  if (status === 'reserved') return 'bg-amber-500 border-amber-200 shadow-amber-500/40';
  if (status === 'occupied') return 'bg-red-600 border-red-200 shadow-red-500/40';
  if (status === 'closed') return 'bg-neutral-600 border-neutral-300 shadow-neutral-500/20';

  return 'bg-emerald-600 border-emerald-200 shadow-emerald-500/40';
}

function getImageForType(objectType: string) {
  const images: Record<string, string> = {
    floor_marble: '/elements/marble.png',
    floor_tile: '/elements/pavement.png',
    floor_pavement: '/elements/pavement.png',
    floor_wood: '/elements/wood-floor.png',
    floor_grass: '/elements/grass.png',
    floor_water: '/elements/water.png',

    table_rect_photo: '/elements/table-rect.png',
    table_round_1_photo: '/elements/table-round-1.png',
    table_round_2_photo: '/elements/table-round-2.png',

    wall: '/elements/wall-stone.png',
    window: '/elements/window.png',
    door: '/elements/door.png',
    stone_fence: '/elements/fence-1.png',
    wood_fence: '/elements/fence-1.png',
    metal_fence: '/elements/fence-2.png',
    bridge: '/elements/bridge.png',
    pier: '/elements/bridge.png',

    bar: '/elements/bar.png',
    sofa: '/elements/sofa-long.png',
    chair_classic: '/elements/chair-1.png',
    chair_soft: '/elements/chair-2.png',
    chair_bar: '/elements/chair-3.png',
    chair_4: '/elements/chair-4.png',
    chair_5: '/elements/chair-5.png',

    tree: '/elements/tree.png',
    bush: '/elements/bush.png',
    stones: '/elements/wall-stone.png',
    lamp_post: '/elements/lamp-post.png',
    spot_light: '/elements/spot-light.png',
    fireplace: '/elements/fireplace.png',
    trampoline: '/elements/trampoline.png',
  };

  return images[objectType] || '';
}

function objectBackground(object: MapObject) {
  const image = getImageForType(object.objectType);
  const fallback = object.color || '#525252';

  if (image) {
    return `url("${image}") center / contain no-repeat, ${fallback}`;
  }

  if (object.objectType === 'fireplace') {
    return 'radial-gradient(circle, #fde68a 0%, #f97316 35%, #dc2626 68%, #450a0a 100%)';
  }

  if (object.objectType === 'lamp_post' || object.objectType === 'spot_light') {
    return 'radial-gradient(circle, #fef08a 0%, #facc15 35%, transparent 72%)';
  }

  return fallback;
}

function objectRadius(object: MapObject) {
  if (object.objectType.includes('round') || object.objectType === 'bush' || object.objectType === 'tree') {
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

  function refreshMap() {
    mapApi
      .get()
      .then((response) => setMap(getMapFromResponse(response)))
      .catch(() => {});
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
      <div className="mx-auto flex min-h-screen max-w-3xl items-center justify-center bg-black px-4 text-white">
        <section className="rounded-[34px] border border-white/10 bg-white/5 p-6 text-center shadow-2xl backdrop-blur-xl">
          <h1 className="text-2xl font-semibold">Ресторан зачинений</h1>
          <p className="mt-3 text-neutral-300">{restaurant.closeMessage}</p>
        </section>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black px-4 py-5 text-white">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
        {step !== 'home' && (
          <button
            onClick={goBack}
            className="inline-flex w-fit items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-neutral-200 backdrop-blur-xl active:scale-95"
          >
            <ArrowLeft className="h-4 w-4" />
            Назад
          </button>
        )}

        {step === 'home' && (
          <section className="overflow-hidden rounded-[38px] border border-white/10 bg-neutral-950 shadow-2xl">
            <div className="relative min-h-[720px]">
              <img
                src="/hero-bg.jpg"
                alt="MOLO"
                className="absolute inset-0 h-full w-full object-cover opacity-70"
              />

              <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/55 to-black" />

              <div className="relative flex min-h-[720px] flex-col justify-end p-5 sm:p-8">
                <div className="mb-auto flex items-center justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.35em] text-amber-100/80">
                      Restaurant
                    </p>
                    <h1 className="mt-2 text-5xl font-black tracking-tight sm:text-7xl">
                      MOLO
                    </h1>
                  </div>
                </div>

                <div className="rounded-[32px] border border-white/10 bg-black/35 p-5 shadow-2xl backdrop-blur-xl">
                  <p className="text-neutral-200">
                    Бронювання столиків, меню та звʼязок з адміністратором.
                  </p>

                  <div className="mt-5 grid gap-3">
                    <button
                      onClick={() => setStep('location_choice')}
                      className="rounded-2xl border border-amber-200/90 bg-amber-300/10 px-5 py-4 text-base font-semibold text-amber-100 shadow-[0_0_34px_rgba(251,191,36,.16)] transition active:scale-[0.99] sm:text-lg"
                    >
                      Забронювати столик
                    </button>

                    <button
                      onClick={openMenu}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-5 py-4 font-semibold text-neutral-100 transition active:scale-[0.99]"
                    >
                      <Menu className="h-5 w-5" />
                      Меню
                    </button>

                    <button
                      onClick={callAdmin}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-5 py-4 font-semibold text-neutral-100 transition active:scale-[0.99]"
                    >
                      <Phone className="h-5 w-5" />
                      Зателефонувати адміністратору
                    </button>
                  </div>

                  <p className="mt-5 text-center text-sm text-neutral-400">
                    Ми працюємо з 10:00 до 23:00
                  </p>
                </div>
              </div>
            </div>
          </section>
        )}

        {step === 'location_choice' && (
          <section className="overflow-hidden rounded-[38px] border border-white/10 bg-neutral-950 shadow-2xl">
            <div className="relative min-h-[680px]">
              <img
                src="/maps/territory-bg.png"
                alt="Вхід до ресторану MOLO"
                className="absolute inset-0 h-full w-full object-cover opacity-80"
              />

              <div className="absolute inset-0 bg-gradient-to-b from-black/35 via-black/40 to-black/80" />

              <button
                aria-label="Зал ресторану"
                onClick={() => setStep('hall_map')}
                className="absolute left-[43%] top-[34%] h-[28%] w-[30%] rounded-[32px] border border-amber-200/0 bg-amber-300/0 transition hover:border-amber-200/70 hover:bg-amber-300/10 active:scale-[0.99]"
              />

              <button
                aria-label="Набережна ресторану"
                onClick={() => setStep('waterfront_choice')}
                className="absolute left-[4%] top-[29%] h-[36%] w-[28%] rounded-[32px] border border-sky-200/0 bg-sky-300/0 transition hover:border-sky-200/70 hover:bg-sky-300/10 active:scale-[0.99]"
              />

              <div className="relative flex min-h-[680px] items-end p-4 sm:p-8">
                <div className="w-full rounded-[34px] border border-white/10 bg-black/55 p-5 text-center shadow-2xl backdrop-blur-xl sm:p-7">
                  <p className="text-sm uppercase tracking-[0.28em] text-amber-100/75">
                    MOLO
                  </p>

                  <h1 className="mt-3 text-2xl font-black tracking-tight sm:text-4xl">
                    Раді вітати вас у ресторані MOLO
                  </h1>

                  <p className="mx-auto mt-3 max-w-2xl text-sm text-neutral-200 sm:text-base">
                    Оберіть локацію, у якій бажаєте забронювати стіл
                  </p>

                  <div className="mt-6 grid gap-3 sm:grid-cols-2">
                    <button
                      onClick={() => setStep('hall_map')}
                      className="rounded-2xl border border-amber-200/80 bg-amber-300/10 px-5 py-4 text-base font-semibold text-amber-100 shadow-[0_0_30px_rgba(251,191,36,.14)] transition active:scale-[0.99]"
                    >
                      Зал ресторану
                    </button>

                    <button
                      onClick={() => setStep('waterfront_choice')}
                      className="rounded-2xl border border-sky-200/70 bg-sky-300/10 px-5 py-4 text-base font-semibold text-sky-100 shadow-[0_0_30px_rgba(56,189,248,.12)] transition active:scale-[0.99]"
                    >
                      Набережна ресторану
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {step === 'waterfront_choice' && (
          <section className="rounded-[38px] border border-white/10 bg-neutral-950 p-5 shadow-2xl sm:p-7">
            <div className="text-center">
              <p className="text-sm uppercase tracking-[0.28em] text-sky-100/75">
                Набережна ресторану
              </p>

              <h1 className="mt-3 text-3xl font-black tracking-tight">
                Оберіть локацію
              </h1>

              <p className="mt-3 text-neutral-300">
                Тут будуть зовнішні зони ресторану. Поки відкриваємо заглушки, а фони додамо окремо.
              </p>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {WATERFRONT_LOCATIONS.map((location) => (
                <button
                  key={location.key}
                  onClick={() => openWaterfrontLocation(location)}
                  className="rounded-[26px] border border-white/10 bg-white/[0.04] p-5 text-left shadow-xl transition active:scale-[0.99]"
                >
                  <div className="flex items-start gap-3">
                    <span className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-sky-300/10 text-sky-100">
                      <MapPin className="h-5 w-5" />
                    </span>

                    <span>
                      <span className="block text-lg font-semibold">
                        {location.label}
                      </span>

                      <span className="mt-1 block text-sm text-neutral-400">
                        {location.description}
                      </span>
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        {step === 'location_placeholder' && selectedWaterfrontLocation && (
          <section className="rounded-[38px] border border-white/10 bg-neutral-950 p-6 text-center shadow-2xl">
            <p className="text-sm uppercase tracking-[0.28em] text-sky-100/75">
              Локація
            </p>

            <h1 className="mt-3 text-3xl font-black tracking-tight">
              {selectedWaterfrontLocation.label}
            </h1>

            <p className="mx-auto mt-4 max-w-xl text-neutral-300">
              Фон цієї локації ще не додано. Після завантаження картинки сюди підключимо вибір столів.
            </p>

            <div className="mt-6 rounded-[30px] border border-dashed border-white/15 bg-white/[0.03] p-8 text-neutral-400">
              Очікується фон локації
            </div>
          </section>
        )}

        {step === 'hall_map' && (
          <section className="rounded-[38px] border border-white/10 bg-neutral-950 p-4 shadow-2xl sm:p-6">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-sm uppercase tracking-[0.28em] text-amber-100/75">
                  Зал ресторану
                </p>

                <h1 className="mt-2 text-3xl font-black tracking-tight">
                  Оберіть стіл
                </h1>

                <p className="mt-2 text-sm text-neutral-300">
                  Оберіть дату, час і вільний стіл.
                </p>
              </div>

              <button
                onClick={refreshMap}
                className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-neutral-200 active:scale-95"
              >
                Оновити
              </button>
            </div>

            <div className="mb-4 grid gap-3 sm:grid-cols-2">
              <label className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                <span className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-neutral-400">
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

              <label className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                <span className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-neutral-400">
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
              <div className="mb-4 rounded-2xl border border-amber-200/20 bg-amber-500/10 p-4 text-sm text-amber-100">
                {restaurant.bookingClosedMessage}
              </div>
            )}

            <div className="overflow-auto rounded-[34px] border border-white/10 bg-black/70 p-2">
              <div
                className="relative overflow-hidden rounded-[28px]"
                style={{
                  width: mapWidth(map),
                  height: mapHeight(map),
                  backgroundImage:
                    'linear-gradient(rgba(0,0,0,.18), rgba(0,0,0,.32)), url("/maps/hall-bg.png")',
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                }}
              >
                {visibleZones.map((zone: Zone) => (
                  <div
                    key={zone.id}
                    className="absolute flex items-center justify-center border border-white/15 bg-white/5 text-xs font-semibold text-white/70 backdrop-blur-[1px]"
                    style={{
                      left: numberValue(zone.x),
                      top: numberValue(zone.y),
                      width: numberValue(zone.width, 160),
                      height: numberValue(zone.height, 90),
                      transform: `rotate(${numberValue(zone.rotation)}deg)`,
                      borderRadius: 24,
                    }}
                  >
                    {zone.isClosed ? '🔒 ' : ''}
                    {zone.name}
                  </div>
                ))}

                {visibleObjects.map((object: MapObject) => (
                  <div
                    key={object.id}
                    className="absolute flex items-center justify-center border border-white/10 text-[10px] font-semibold text-white/80 shadow-lg"
                    style={{
                      left: numberValue(object.x),
                      top: numberValue(object.y),
                      width: numberValue(object.width, 80),
                      height: numberValue(object.height, 80),
                      transform: `rotate(${numberValue(object.rotation)}deg)`,
                      borderRadius: objectRadius(object),
                      background: objectBackground(object),
                    }}
                  >
                    {object.name || ''}
                  </div>
                ))}

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
                      className={`absolute flex items-center justify-center border text-xs font-black text-white shadow-xl ring-2 ring-white/20 transition active:scale-95 ${
                        table.shape === 'round' ? 'rounded-full' : 'rounded-xl'
                      } ${tableColor(table)}`}
                      style={{
                        left: numberValue(table.x),
                        top: numberValue(table.y),
                        width: numberValue(table.width, 86),
                        height: numberValue(table.height, 86),
                        transform: `rotate(${numberValue(table.rotation)}deg)`,
                        opacity: isBlocked ? 0.9 : 1,
                      }}
                      title={STATUS_TEXT[status]}
                    >
                      {isBlocked && status === 'closed' ? (
                        <span className="absolute text-lg">✕</span>
                      ) : null}

                      <span className="rounded-full bg-black/35 px-2 py-1">
                        {table.tableNumber}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-neutral-300 sm:flex">
              <span className="inline-flex items-center gap-2">
                <span className="h-3 w-3 rounded-full bg-emerald-500" />
                Вільний
              </span>

              <span className="inline-flex items-center gap-2">
                <span className="h-3 w-3 rounded-full bg-amber-500" />
                Бронь
              </span>

              <span className="inline-flex items-center gap-2">
                <span className="h-3 w-3 rounded-full bg-red-600" />
                Зайнятий
              </span>

              <span className="inline-flex items-center gap-2">
                <span className="h-3 w-3 rounded-full bg-neutral-600" />
                Закритий
              </span>
            </div>
          </section>
        )}

        {step === 'form' && selectedTable && (
          <section className="rounded-[34px] border border-white/10 bg-neutral-950 p-6 shadow-2xl">
            <h1 className="text-2xl font-semibold">
              Стіл №{selectedTable.tableNumber}
            </h1>

            <p className="mt-2 text-neutral-300">
              до {selectedTable.seats} гостей · {date} · {time}
            </p>

            <div className="mt-6 grid gap-4">
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
                <span className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-neutral-400">
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
                className="min-h-24 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 outline-none"
              />

              {error && <p className="text-sm text-red-300">{error}</p>}

              <button
                disabled={loading}
                onClick={submit}
                className="w-full rounded-2xl border border-amber-200/80 bg-amber-300/10 px-5 py-4 font-semibold text-amber-100 disabled:opacity-50"
              >
                Надіслати заявку
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
              onClick={() => setStep('home')}
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
