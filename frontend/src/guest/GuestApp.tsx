import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Clock,
  Menu,
  Phone,
  Users,
} from 'lucide-react';

import type { FullMapResponse, MapObject, Restaurant, TableItem } from '../api/types';
import { mapApi } from '../api/map';
import { restaurantApi } from '../api/restaurant';
import { bookingsApi } from '../api/bookings';
import { useAsyncAction } from '../hooks/useAsyncAction';

const FALLBACK_MENU =
  'https://expz.menu/8ec3f3d4-0e9f-4ed7-a03f-5f4deaba843e?utm_source=ig&utm_medium=social&utm_content=link_in_bio';

type Step = 'home' | 'map' | 'form' | 'success';
type TableStatus = 'free' | 'reserved' | 'occupied';

const GUEST_MAP_SCALE = 0.55;

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeTableStatus(status: unknown): TableStatus {
  if (status === 'reserved' || status === 'booked') return 'reserved';
  if (status === 'occupied') return 'occupied';
  return 'free';
}

function isZoneObject(type: string) {
  return type === 'zone_rect' || type === 'zone_oval';
}

function isFloorObject(type: string) {
  return type.startsWith('floor_') || type.startsWith('zone_');
}

function isOvalObject(type: string) {
  return type.includes('oval');
}

function getObjectLayer(type: string) {
  if (type.startsWith('floor_') || type.startsWith('zone_')) return 1;
  if (type === 'bridge' || type === 'pier') return 2;

  if (
    type === 'wall' ||
    type === 'window' ||
    type === 'door' ||
    type === 'stone_fence' ||
    type === 'wood_fence'
  ) {
    return 3;
  }

  if (
    type === 'bar' ||
    type === 'sofa' ||
    type === 'chair' ||
    type === 'fireplace' ||
    type === 'trampoline'
  ) {
    return 4;
  }

  if (
    type === 'lamp' ||
    type === 'spot_light' ||
    type === 'lamp_post' ||
    type === 'tree' ||
    type === 'stones' ||
    type === 'bush'
  ) {
    return 5;
  }

  if (type === 'text' || type === 'number') return 8;

  return 4;
}

function getObjectBorderRadius(type: string) {
  if (
    type === 'tree' ||
    type === 'lamp' ||
    type === 'spot_light' ||
    type === 'lamp_post' ||
    type === 'bush' ||
    type === 'number'
  ) {
    return '999px';
  }

  if (isOvalObject(type)) return '999px';
  if (type === 'window' || type === 'wall' || type.includes('fence')) return '12px';
  if (isFloorObject(type)) return '28px';

  return '18px';
}

function getObjectBackground(object: MapObject) {
  const type = String(object.objectType || '');
  const color = String(object.color || '#525252');

  if (type === 'floor_marble') {
    return `
      linear-gradient(135deg, rgba(255,255,255,.9), rgba(255,255,255,.25)),
      repeating-linear-gradient(45deg, ${color}, ${color} 22px, #f5f5f4 22px, #f5f5f4 26px, #a8a29e 26px, #a8a29e 44px)
    `;
  }

  if (type === 'floor_tile') {
    return `
      radial-gradient(circle at 20% 20%, rgba(245,158,11,.08), transparent 28%),
      repeating-linear-gradient(45deg, ${color}, ${color} 18px, #292524 18px, #292524 34px)
    `;
  }

  if (type === 'floor_pavement') {
    return `
      repeating-linear-gradient(90deg, ${color}, ${color} 22px, #292524 22px, #292524 28px),
      repeating-linear-gradient(0deg, transparent, transparent 22px, rgba(0,0,0,.3) 22px, rgba(0,0,0,.3) 28px)
    `;
  }

  if (type === 'floor_wood' || type === 'bridge' || type === 'pier') {
    return `
      repeating-linear-gradient(90deg, ${color}, ${color} 24px, #3f2a14 24px, #3f2a14 31px),
      linear-gradient(180deg, rgba(255,255,255,.12), rgba(0,0,0,.18))
    `;
  }

  if (type === 'floor_grass') {
    return `
      radial-gradient(circle at 18% 25%, rgba(190,242,100,.18), transparent 26%),
      repeating-linear-gradient(45deg, #365314, #365314 12px, #65a30d 12px, #65a30d 20px)
    `;
  }

  if (type === 'floor_water') {
    return `
      radial-gradient(circle at 25% 20%, rgba(125,211,252,.42), transparent 23%),
      radial-gradient(circle at 70% 70%, rgba(14,165,233,.22), transparent 25%),
      linear-gradient(135deg, #082f49, #075985, #020617)
    `;
  }

  if (type === 'zone_rect' || type === 'zone_oval') {
    return `
      radial-gradient(circle at 20% 20%, rgba(245,158,11,.10), transparent 30%),
      linear-gradient(135deg, ${color}, #15110d)
    `;
  }

  if (type === 'tree') {
    return `radial-gradient(circle, #22c55e 0%, ${color} 56%, #14532d 100%)`;
  }

  if (type === 'bush') {
    return `radial-gradient(circle, #84cc16 0%, #3f6212 60%, #1a2e05 100%)`;
  }

  if (type === 'lamp' || type === 'spot_light' || type === 'lamp_post') {
    return `radial-gradient(circle, #fef08a 0%, #facc15 35%, rgba(250,204,21,.25) 58%, transparent 100%)`;
  }

  if (type === 'fireplace') {
    return `radial-gradient(circle, #fde68a 0%, #f97316 35%, ${color} 68%, #450a0a 100%)`;
  }

  if (type === 'bar') {
    return `linear-gradient(135deg, #f59e0b, ${color}, #451a03)`;
  }

  if (type === 'sofa') {
    return `linear-gradient(180deg, ${color}, #450a0a)`;
  }

  if (type === 'chair') {
    return `linear-gradient(180deg, #a16207, ${color})`;
  }

  if (type === 'window') {
    return `linear-gradient(180deg, #7dd3fc, #38bdf8, #0f172a)`;
  }

  if (type === 'door') {
    return `linear-gradient(180deg, #b45309, ${color}, #451a03)`;
  }

  if (type === 'wall') {
    return `linear-gradient(180deg, #78716c, ${color}, #1c1917)`;
  }

  if (type === 'stone_fence') {
    return `repeating-linear-gradient(90deg, ${color}, ${color} 28px, #292524 28px, #292524 34px)`;
  }

  if (type === 'wood_fence') {
    return `repeating-linear-gradient(90deg, ${color}, ${color} 26px, #3f2a14 26px, #3f2a14 32px)`;
  }

  if (type === 'metal_fence') {
    return `repeating-linear-gradient(90deg, ${color}, ${color} 12px, transparent 12px, transparent 24px)`;
  }

  if (type === 'stones') {
    return `
      radial-gradient(circle at 22% 50%, #a8a29e 0 12px, transparent 13px),
      radial-gradient(circle at 52% 45%, ${color} 0 14px, transparent 15px),
      radial-gradient(circle at 75% 55%, #57534e 0 10px, transparent 11px)
    `;
  }

  if (type === 'trampoline') {
    return `radial-gradient(circle, #111827 0%, #111827 58%, #38bdf8 60%, #38bdf8 70%, transparent 72%)`;
  }

  if (type === 'text' || type === 'number') {
    return 'transparent';
  }

  return color;
}

function getObjectShadow(type: string) {
  if (type === 'lamp' || type === 'spot_light' || type === 'lamp_post') {
    return '0 0 34px rgba(250,204,21,.9)';
  }

  if (type === 'fireplace') {
    return '0 0 30px rgba(249,115,22,.75)';
  }

  if (isFloorObject(type)) {
    return 'inset 0 0 38px rgba(0,0,0,.62), 0 14px 28px rgba(0,0,0,.28)';
  }

  return '0 12px 24px rgba(0,0,0,.45)';
}

function isServiceMaterialName(name: string) {
  const value = name.trim().toLowerCase();

  return [
    'мрамор',
    'мармур',
    'мраморна плитка',
    'плитка',
    'тротуар',
    'тротуарна плитка',
    'вода',
    'газон',
    'трава',
    'дерево',
    'камни',
    'камешки',
    'стіна',
    'стена',
    'окно',
    'вікно',
    'дверь',
    'двері',
    'камин',
    'камін',
    'фонарь',
    'ліхтар',
    'забор',
  ].includes(value);
}

function shouldShowObjectText(object: MapObject) {
  const type = String(object.objectType || '');
  const name = String(object.name || '').trim();

  if (!name) return false;

  if (isServiceMaterialName(name)) return false;
  if (isZoneObject(type)) return true;
  if (type === 'text') return true;
  if (type === 'number') return true;

  return false;
}

function tableStyle(table: TableItem, selected: boolean) {
  const status = normalizeTableStatus((table as any).status);

  if (selected) {
    return {
      background: '#f59e0b',
      border: '#fde68a',
      shadow: '0 0 0 3px rgba(251,191,36,.9), 0 0 24px rgba(251,191,36,.85)',
    };
  }

  if (status === 'occupied') {
    return {
      background: '#b91c1c',
      border: '#fca5a5',
      shadow: '0 0 18px rgba(239,68,68,.65)',
    };
  }

  if (status === 'reserved') {
    return {
      background: '#d97706',
      border: '#fcd34d',
      shadow: '0 0 18px rgba(245,158,11,.65)',
    };
  }

  return {
    background: '#166534',
    border: '#6ee7b7',
    shadow: '0 0 18px rgba(34,197,94,.65)',
  };
}

function TableButton({
  table,
  selected,
  onClick,
}: {
  table: TableItem;
  selected: boolean;
  onClick: () => void;
}) {
  const colors = tableStyle(table, selected);
  const isRound = table.shape === 'round';

  return (
    <button
      onClick={onClick}
      className="absolute flex items-center justify-center border-2 text-xs font-bold text-white"
      style={{
        left: numberValue(table.x),
        top: numberValue(table.y),
        width: numberValue(table.width, 80),
        height: numberValue(table.height, 70),
        transform: `rotate(${numberValue((table as any).rotation)}deg)`,
        borderRadius: isRound ? '999px' : '14px',
        background: colors.background,
        borderColor: colors.border,
        boxShadow: colors.shadow,
        zIndex: 20,
      }}
    >
      {table.tableNumber}
    </button>
  );
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
    restaurantApi.get().then(setRestaurant).catch(() => {});
    mapApi.get().then(setMap).catch(() => {});
  }, []);

  function callAdmin() {
    if (restaurant?.phone) {
      window.location.href = `tel:${restaurant.phone}`;
    }
  }

  function openMenu() {
    window.open(restaurant?.menuUrl || FALLBACK_MENU, '_blank');
  }

  function chooseTable(table: TableItem) {
    const status = normalizeTableStatus((table as any).status);

    if ((restaurant as any)?.status === 'booking_closed') {
      callAdmin();
      return;
    }

    if (status !== 'free') {
      callAdmin();
      return;
    }

    setSelectedTable(table);
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

    if (result) {
      setStep('success');
    }
  }

  if ((restaurant as any)?.status === 'closed') {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="max-w-md rounded-3xl border border-neutral-800 bg-neutral-900 p-6 text-center">
          <h1 className="text-2xl font-semibold">Ресторан зачинений</h1>
          <p className="mt-3 text-neutral-300">{(restaurant as any)?.closeMessage}</p>
        </div>
      </div>
    );
  }

  const mapRestaurant = (map as any)?.restaurant || restaurant;
  const mapWidth = numberValue((mapRestaurant as any)?.mapWidth, 1600);
  const mapHeight = numberValue((mapRestaurant as any)?.mapHeight, 1000);

  const objects = (((map as any)?.objects || []) as MapObject[]).sort((a, b) => {
    return getObjectLayer(String(a.objectType || '')) - getObjectLayer(String(b.objectType || ''));
  });

  const tables = (map?.tables || []).filter((table) => table.isVisible !== false);

  return (
    <div className="mx-auto max-w-md px-4 py-5 pb-24">
      {step !== 'home' && (
        <button
          onClick={() => setStep(step === 'form' ? 'map' : 'home')}
          className="mb-4 flex items-center gap-2 text-sm text-neutral-300"
        >
          <ArrowLeft className="h-4 w-4" />
          Назад
        </button>
      )}

      {step === 'home' && (
        <section className="space-y-5">
          <div className="overflow-hidden rounded-3xl border border-neutral-800 bg-neutral-900 shadow-2xl">
            <div className="p-5">
              <img
                src="/logo.png"
                alt="MOLO"
                className="mb-5 max-h-40 w-full rounded-2xl object-contain"
                onError={(event) => {
                  event.currentTarget.style.display = 'none';
                }}
              />

              <p className="text-sm uppercase tracking-[0.3em] text-amber-300/80">
                Restaurant
              </p>

              <h1 className="mt-2 text-3xl font-semibold">MOLO</h1>

              <p className="mt-2 text-sm text-neutral-300">
                Бронювання столиків, меню та звʼязок з адміністратором.
              </p>
            </div>
          </div>

          <div className="grid gap-3">
            <button
              onClick={openMenu}
              className="flex items-center gap-3 rounded-2xl border border-neutral-800 bg-neutral-900 px-5 py-4"
            >
              <Menu className="h-5 w-5 text-amber-300" />
              Меню
            </button>

            <button
              onClick={() => setStep('map')}
              className="rounded-2xl bg-amber-300 px-5 py-4 font-semibold text-neutral-950"
            >
              Забронювати столик
            </button>

            <button
              onClick={callAdmin}
              className="flex items-center justify-center gap-3 rounded-2xl border border-neutral-700 bg-neutral-900 px-5 py-4"
            >
              <Phone className="h-5 w-5 text-emerald-400" />
              Зателефонувати адміністратору
            </button>
          </div>
        </section>
      )}

      {step === 'map' && (
        <section className="space-y-4">
          <h1 className="text-2xl font-semibold">Карта ресторану</h1>

          <div className="grid grid-cols-2 gap-3">
            <label className="rounded-2xl bg-neutral-900 p-3">
              <span className="flex items-center gap-2 text-xs text-neutral-400">
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

            <label className="rounded-2xl bg-neutral-900 p-3">
              <span className="flex items-center gap-2 text-xs text-neutral-400">
                <Clock className="h-4 w-4" />
                Час
              </span>

              <input
                value={time}
                onChange={(event) => setTime(event.target.value)}
                type="time"
                step="900"
                className="mt-2 w-full bg-transparent text-sm outline-none"
              />
            </label>
          </div>

          {(restaurant as any)?.status === 'booking_closed' && (
            <div className="rounded-2xl bg-amber-500/10 p-4 text-sm text-amber-100">
              {(restaurant as any)?.bookingClosedMessage}
            </div>
          )}

          <div className="relative h-[560px] overflow-auto rounded-3xl border border-neutral-800 bg-[#0b0a08]">
            <div
              className="relative"
              style={{
                width: mapWidth * GUEST_MAP_SCALE,
                height: mapHeight * GUEST_MAP_SCALE,
              }}
            >
              <div
                className="relative origin-top-left overflow-hidden rounded-[28px]"
                style={{
                  width: mapWidth,
                  height: mapHeight,
                  transform: `scale(${GUEST_MAP_SCALE})`,
                  transformOrigin: 'top left',
                  background:
                    'radial-gradient(circle at 20% 20%, rgba(245,158,11,.08), transparent 30%), linear-gradient(135deg, #0b0a08, #17120d)',
                }}
              >
                <div
                  className="absolute inset-0 opacity-15"
                  style={{
                    backgroundImage:
                      'linear-gradient(rgba(255,255,255,.08) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.08) 1px, transparent 1px)',
                    backgroundSize: '50px 50px',
                  }}
                />

                {objects.map((object) => {
                  const type = String(object.objectType || '');
                  const showText = shouldShowObjectText(object);

                  return (
                    <div
                      key={String(object.id)}
                      className="absolute flex items-center justify-center border text-center text-xs font-semibold text-white"
                      style={{
                        left: numberValue(object.x),
                        top: numberValue(object.y),
                        width: numberValue(object.width, 100),
                        height: numberValue(object.height, 100),
                        transform: `rotate(${numberValue((object as any).rotation)}deg)`,
                        background: getObjectBackground(object),
                        borderRadius: getObjectBorderRadius(type),
                        borderColor: 'rgba(255,255,255,.14)',
                        boxShadow: getObjectShadow(type),
                        zIndex: getObjectLayer(type),
                      }}
                    >
                      {showText ? (
                        <span className="rounded-full bg-black/45 px-4 py-2 text-sm drop-shadow">
                          {object.name}
                        </span>
                      ) : null}
                    </div>
                  );
                })}

                {tables.map((table) => (
                  <TableButton
                    key={String(table.id)}
                    table={table}
                    selected={selectedTable?.id === table.id}
                    onClick={() => chooseTable(table)}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 text-xs text-neutral-300">
            <span>🟢 Вільний</span>
            <span>🟠 Бронь</span>
            <span>🔴 Зайнятий</span>
          </div>
        </section>
      )}

      {step === 'form' && selectedTable && (
        <section className="space-y-4">
          <div className="rounded-3xl border border-neutral-800 bg-neutral-900 p-5">
            <h1 className="text-2xl font-semibold">
              Стіл №{selectedTable.tableNumber}
            </h1>

            <p className="mt-2 text-neutral-300">
              <Users className="inline h-4 w-4 text-amber-300" /> до{' '}
              {selectedTable.seats} гостей · {date} · {time}
            </p>
          </div>

          <div className="space-y-3 rounded-3xl border border-neutral-800 bg-neutral-900 p-5">
            <input
              placeholder="Імʼя"
              value={form.fullName}
              onChange={(event) => setForm({ ...form, fullName: event.target.value })}
              className="w-full rounded-2xl bg-neutral-800 px-4 py-3 outline-none"
            />

            <input
              placeholder="Номер телефону"
              value={form.phone}
              onChange={(event) => setForm({ ...form, phone: event.target.value })}
              className="w-full rounded-2xl bg-neutral-800 px-4 py-3 outline-none"
            />

            <input
              type="number"
              value={form.guestsCount}
              onChange={(event) =>
                setForm({ ...form, guestsCount: Number(event.target.value) })
              }
              className="w-full rounded-2xl bg-neutral-800 px-4 py-3 outline-none"
            />

            <textarea
              placeholder="Побажання"
              value={form.wishes}
              onChange={(event) => setForm({ ...form, wishes: event.target.value })}
              className="min-h-24 w-full rounded-2xl bg-neutral-800 px-4 py-3 outline-none"
            />

            {error && <p className="text-sm text-red-300">{error}</p>}

            <button
              disabled={loading}
              onClick={submit}
              className="w-full rounded-2xl bg-amber-300 px-5 py-4 font-semibold text-neutral-950 disabled:opacity-50"
            >
              Надіслати заявку
            </button>
          </div>
        </section>
      )}

      {step === 'success' && (
        <section className="rounded-3xl border border-neutral-800 bg-neutral-900 p-6 text-center">
          <CheckCircle2 className="mx-auto mb-4 h-12 w-12 text-emerald-400" />

          <h1 className="text-2xl font-semibold">Заявку надіслано</h1>

          <p className="mt-3 text-neutral-300">
            Адміністратор отримає заявку та підтвердить бронювання.
          </p>

          <button
            onClick={() => setStep('home')}
            className="mt-6 w-full rounded-2xl bg-amber-300 px-5 py-4 font-semibold text-neutral-950"
          >
            На головну
          </button>
        </section>
      )}
    </div>
  );
}
