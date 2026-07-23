import { useState } from 'react';

import AdminAuthGate from './AdminAuthGate';
import AdminStaffPanel from './AdminStaffPanel';
import CompactAdminPanel from './CompactAdminPanel';

type AdminSection = 'main' | 'staff';

export default function AdminWorkspace() {
  const [section, setSection] = useState<AdminSection>('main');

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
          </div>
        </div>

        {section === 'main' ? (
          <CompactAdminPanel />
        ) : (
          <main className="mx-auto max-w-5xl p-4 pb-28 lg:p-8">
            <AdminStaffPanel />
          </main>
        )}
      </div>
    </AdminAuthGate>
  );
}
