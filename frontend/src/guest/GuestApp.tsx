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

import type { FullMapResponse, TableItem, Restaurant } from '../api/types';
import { mapApi } from '../api/map';
import { restaurantApi } from '../api/restaurant';
import { bookingsApi } from '../api/bookings';
import { useAsyncAction } from '../hooks/useAsyncAction';

const FALLBACK_MENU =
  'https://expz.menu/8ec3f3d4-0e9f-4ed7-a03f-5f4deaba843e?utm_source=ig&utm_medium=social&utm_content=link_in_bio';

export default function GuestApp() {
  const [step, setStep] = useState<'home' | 'map' | 'form' | 'success'>('home');
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

  async function submit() {
    if (!selectedTable) return;

    const res = await run(() =>
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

    if (res) setStep('success');
  }

  if (restaurant?.status === 'closed') {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="max-w-md rounded-3xl border border-neutral-800 bg-neutral-900 p-6 text-center">
          <h1 className="text-2xl font-semibold">Ресторан зачинений</h1>
          <p className="mt-3 text-neutral-300">{restaurant.closeMessage}</p>
        </div>
      </div>
    );
  }

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
            <div className="h-48 bg-gradient-to-br from-neutral-700 via-neutral-900 to-black" />

            <div className="p-5">
              <img
                src="/logo.png"
                alt="MOLO"
                className="mb-5 h-28 w-auto object-contain"
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
                onChange={(e) => setDate(e.target.value)}
                type="date"
                className="mt-2 w-full bg-transparent text-sm outline-none"
              />
            </label>

            <label className="rounded-2xl bg-neutral-900 p-3">
              <span className="flex items-center gap-2 text-xs text-neutral-400">
                <Clock className="h-4 w-4" />
                Час
              </span>

              <select
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="mt-2 w-full bg-neutral-900 text-sm outline-none"
              >
                {[
                  '12:00',
                  '13:00',
                  '14:00',
                  '15:00',
                  '16:00',
                  '17:00',
                  '18:00',
                  '19:00',
                  '20:00',
                  '21:00',
                ].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
          </div>

          {restaurant?.status === 'booking_closed' && (
            <div className="rounded-2xl bg-amber-500/10 p-4 text-sm text-amber-100">
              {restaurant.bookingClosedMessage}
            </div>
          )}

          <div className="relative h-[520px] overflow-auto rounded-3xl border border-neutral-800 bg-[#1a1712]">
            {map?.zones?.map((z) => (
              <div
                key={z.id}
                className={`absolute rounded-3xl border p-3 text-xs ${
                  z.isClosed
                    ? 'border-red-500 bg-red-900/30'
                    : 'border-neutral-700 bg-neutral-900/70'
                }`}
                style={{
                  left: Number(z.x),
                  top: Number(z.y),
                  width: Number(z.width),
                  height: Number(z.height),
                }}
              >
                {z.isClosed ? '🔒 ' : ''}
                {z.name}
              </div>
            ))}

            {map?.tables
              ?.filter((t) => t.isVisible)
              .map((t) => (
                <button
                  key={t.id}
                  onClick={() => {
                    if (
                      restaurant?.status === 'booking_closed' ||
                      t.status !== 'free' ||
                      t.zone?.isClosed
                    ) {
                      callAdmin();
                      return;
                    }

                    setSelectedTable(t);
                    setStep('form');
                  }}
                  className={`absolute flex items-center justify-center border text-xs font-bold text-white shadow-lg ${
                    t.shape === 'round' ? 'rounded-full' : 'rounded-xl'
                  } ${t.status === 'free' ? 'bg-emerald-500' : 'bg-amber-500'}`}
                  style={{
                    left: Number(t.x),
                    top: Number(t.y),
                    width: Number(t.width),
                    height: Number(t.height),
                  }}
                >
                  {t.tableNumber}
                </button>
              ))}
          </div>

          <div className="grid grid-cols-3 gap-2 text-xs text-neutral-300">
            <span>🟢 Вільний</span>
            <span>🟠 Заброньований</span>
            <span>⚫ Зайнятий</span>
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
              onChange={(e) => setForm({ ...form, fullName: e.target.value })}
              className="w-full rounded-2xl bg-neutral-800 px-4 py-3 outline-none"
            />

            <input
              placeholder="Номер телефону"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              className="w-full rounded-2xl bg-neutral-800 px-4 py-3 outline-none"
            />

            <input
              type="number"
              value={form.guestsCount}
              onChange={(e) =>
                setForm({ ...form, guestsCount: Number(e.target.value) })
              }
              className="w-full rounded-2xl bg-neutral-800 px-4 py-3 outline-none"
            />

            <textarea
              placeholder="Побажання"
              value={form.wishes}
              onChange={(e) => setForm({ ...form, wishes: e.target.value })}
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
