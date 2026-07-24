import { useState } from 'react';
import { CalendarClock } from 'lucide-react';

import AdminAuthGate from './AdminAuthGate';
import AdminStaffPanel from './AdminStaffPanel';
import CompactAdminPanel from './CompactAdminPanel';
import AdminVisualTablePlanner from './AdminVisualTablePlanner';

type AdminSection = 'main' | 'staff';

export default function AdminWorkspace() {
  const [section, setSection] = useState<AdminSection>('main');
  const [planningOpen, setPlanningOpen] = useState(false);

  return (
    <AdminAuthGate>
      <div className="min-h-screen bg-black text-white">
        <div className="sticky top-0 z-50 border-b border-white/10 bg-black/90 px-3 py-2 backdrop-blur-xl">
          <div className="mx-auto flex max-w-7xl gap-2">
            <button
              type="button"
              onClick={() => setSection('main')}
              className={`flex-1 rounded-2xl px-4 py-3 text-sm font-black transition active:scale-[0.98] ${
                section === 'main'
                  ? 'bg-amber-300 text-neutral-950 shadow-[0_0_22px_rgba(251,191,36,.14)]'
                  : 'border border-white/10 bg-neutral-900 text-white/70'
              }`}
            >
              Пульт
            </button>

            <button
              type="button"
              onClick={() => setSection('staff')}
              className={`flex-1 rounded-2xl px-4 py-3 text-sm font-black transition active:scale-[0.98] ${
                section === 'staff'
                  ? 'bg-amber-300 text-neutral-950 shadow-[0_0_22px_rgba(251,191,36,.14)]'
                  : 'border border-white/10 bg-neutral-900 text-white/70'
              }`}
            >
              Персонал
            </button>

            <button
              type="button"
              onClick={() => setPlanningOpen(true)}
              title="Планування столів і локацій"
              aria-label="Планування столів і локацій"
              className="grid h-[46px] w-[46px] shrink-0 place-items-center rounded-2xl border border-fuchsia-300/30 bg-fuchsia-400/10 text-fuchsia-100 shadow-[0_0_20px_rgba(217,70,239,.08)] transition active:scale-95"
            >
              <CalendarClock size={20} />
            </button>
          </div>
        </div>

        {section === 'main' ? (
          <CompactAdminPanel />
        ) : (
          <main className="mx-auto max-w-5xl p-4 pb-28 lg:p-8">
            <AdminStaffPanel />
          </main>
        )}

        {planningOpen && (
          <AdminVisualTablePlanner onClose={() => setPlanningOpen(false)} />
        )}
      </div>
    </AdminAuthGate>
  );
}
