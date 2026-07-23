import { useState } from 'react';

import AdminAuthGate from './AdminAuthGate';
import AdminCompactPanel from './AdminCompactPanel';
import AdminPanel from './AdminPanel';
import AdminStaffPanel from './AdminStaffPanel';

type AdminSection = 'quick' | 'full' | 'staff';

export default function AdminWorkspace() {
  const [section, setSection] = useState<AdminSection>('quick');

  return (
    <AdminAuthGate>
      <div className="min-h-screen bg-black text-white">
        <div className="sticky top-0 z-50 border-b border-white/10 bg-black/90 px-3 py-2 backdrop-blur-xl">
          <div className="mx-auto grid max-w-7xl grid-cols-3 gap-2">
            <SectionButton active={section === 'quick'} onClick={() => setSection('quick')}>Швидкий пульт</SectionButton>
            <SectionButton active={section === 'full'} onClick={() => setSection('full')}>Повна панель</SectionButton>
            <SectionButton active={section === 'staff'} onClick={() => setSection('staff')}>Персонал</SectionButton>
          </div>
        </div>

        {section === 'quick' && <AdminCompactPanel />}
        {section === 'full' && <AdminPanel />}
        {section === 'staff' && (
          <main className="mx-auto max-w-5xl p-3 pb-28 sm:p-4 lg:p-6">
            <AdminStaffPanel />
          </main>
        )}
      </div>
    </AdminAuthGate>
  );
}

function SectionButton({ active, children, onClick }: { active: boolean; children: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl px-2 py-2.5 text-xs font-black transition active:scale-[0.98] sm:text-sm ${
        active
          ? 'border border-amber-200/55 bg-amber-300/15 text-amber-100 shadow-[0_0_24px_rgba(251,191,36,.12)]'
          : 'border border-white/10 bg-neutral-900 text-white/60'
      }`}
    >
      {children}
    </button>
  );
}
