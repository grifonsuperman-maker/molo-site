import { useState } from 'react';

import AdminPanel from './AdminPanel';
import AdminStaffPanel from './AdminStaffPanel';

type AdminSection = 'main' | 'staff';

export default function AdminWorkspace() {
  const [section, setSection] = useState<AdminSection>('main');

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="sticky top-0 z-50 border-b border-white/10 bg-black/90 px-4 py-3 backdrop-blur-xl">
        <div className="mx-auto grid max-w-7xl grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setSection('main')}
            className={`rounded-2xl px-4 py-3 text-sm font-black transition active:scale-[0.98] ${
              section === 'main'
                ? 'bg-amber-300 text-neutral-950'
                : 'border border-white/10 bg-neutral-900 text-white/70'
            }`}
          >
            Адмінпанель
          </button>

          <button
            type="button"
            onClick={() => setSection('staff')}
            className={`rounded-2xl px-4 py-3 text-sm font-black transition active:scale-[0.98] ${
              section === 'staff'
                ? 'bg-amber-300 text-neutral-950'
                : 'border border-white/10 bg-neutral-900 text-white/70'
            }`}
          >
            Персонал
          </button>
        </div>
      </div>

      {section === 'main' ? (
        <AdminPanel />
      ) : (
        <main className="mx-auto max-w-5xl p-4 pb-28 lg:p-8">
          <AdminStaffPanel />
        </main>
      )}
    </div>
  );
}
