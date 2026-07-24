import { useEffect, useState } from 'react';
import { CalendarClock, MessageSquareText, UsersRound } from 'lucide-react';

import { restaurantApi } from '../api/restaurant';
import AdminAuthGate from './AdminAuthGate';
import AdminReviewsPanel from './AdminReviewsPanel';
import AdminShiftPanel from './AdminShiftPanel';
import AdminVisualTablePlanner from './AdminVisualTablePlanner';
import CompactAdminPanel from './CompactAdminPanel';

type AdminSection = 'main' | 'shifts' | 'reviews';

export default function AdminWorkspace() {
  const [section, setSection] = useState<AdminSection>('main');
  const [planningOpen, setPlanningOpen] = useState(false);
  const [canManageZones, setCanManageZones] = useState(false);
  const [canManageShifts, setCanManageShifts] = useState(false);

  useEffect(() => {
    let active = true;
    restaurantApi.get()
      .then((restaurant) => {
        if (!active) return;
        setCanManageZones(Boolean(restaurant.adminCanManageZones));
        setCanManageShifts(Boolean(restaurant.adminCanManageStaffShifts));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  return (
    <AdminAuthGate>
      <div className="min-h-screen bg-black text-white">
        <div className="sticky top-0 z-50 border-b border-white/10 bg-black/90 px-3 py-2 backdrop-blur-xl">
          <div className="mx-auto flex max-w-7xl gap-2">
            <button
              type="button"
              onClick={() => setSection('main')}
              className={`min-w-0 flex-1 rounded-2xl px-3 py-3 text-xs font-black transition active:scale-[0.98] sm:text-sm ${
                section === 'main'
                  ? 'bg-amber-300 text-neutral-950 shadow-[0_0_22px_rgba(251,191,36,.14)]'
                  : 'border border-white/10 bg-neutral-900 text-white/70'
              }`}
            >
              Пульт
            </button>

            {canManageShifts && (
              <button
                type="button"
                onClick={() => setSection('shifts')}
                title="Зміни персоналу"
                className={`grid h-[46px] w-[46px] shrink-0 place-items-center rounded-2xl border transition active:scale-95 ${
                  section === 'shifts'
                    ? 'border-emerald-200/45 bg-emerald-400/15 text-emerald-100'
                    : 'border-white/10 bg-neutral-900 text-white/60'
                }`}
              >
                <UsersRound size={20} />
              </button>
            )}

            <button
              type="button"
              onClick={() => setSection('reviews')}
              title="Письмові відгуки"
              className={`grid h-[46px] w-[46px] shrink-0 place-items-center rounded-2xl border transition active:scale-95 ${
                section === 'reviews'
                  ? 'border-violet-200/45 bg-violet-400/15 text-violet-100'
                  : 'border-white/10 bg-neutral-900 text-white/60'
              }`}
            >
              <MessageSquareText size={20} />
            </button>

            {canManageZones && (
              <button
                type="button"
                onClick={() => setPlanningOpen(true)}
                title="Планування столів і локацій"
                aria-label="Планування столів і локацій"
                className="grid h-[46px] w-[46px] shrink-0 place-items-center rounded-2xl border border-fuchsia-300/30 bg-fuchsia-400/10 text-fuchsia-100 shadow-[0_0_20px_rgba(217,70,239,.08)] transition active:scale-95"
              >
                <CalendarClock size={20} />
              </button>
            )}
          </div>
        </div>

        {section === 'main' && <CompactAdminPanel />}
        {section === 'shifts' && canManageShifts && (
          <main className="mx-auto max-w-5xl p-4 pb-28 lg:p-8">
            <AdminShiftPanel />
          </main>
        )}
        {section === 'reviews' && (
          <main className="mx-auto max-w-5xl p-4 pb-28 lg:p-8">
            <AdminReviewsPanel />
          </main>
        )}

        {planningOpen && canManageZones && (
          <AdminVisualTablePlanner onClose={() => setPlanningOpen(false)} />
        )}
      </div>
    </AdminAuthGate>
  );
}
