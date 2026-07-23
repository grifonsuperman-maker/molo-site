import { useState } from 'react';

import AdminAuthGate from './AdminAuthGate';
import AdminNeonPanel from './AdminNeonPanel';
import AdminPanel from './AdminPanel';
import AdminStaffPanel from './AdminStaffPanel';

type AdminSection = 'neon' | 'full' | 'staff';

export default function AdminWorkspace() {
  const [section, setSection] = useState<AdminSection>('neon');

  return (
    <AdminAuthGate>
      <div className="min-h-screen bg-black text-white">
        <div className="sticky top-0 z-[70] border-b border-amber-200/15 bg-black/95 px-3 py-3 shadow-[0_0_34px_rgba(251,191,36,.06)] backdrop-blur-xl">
          <div className="mx-auto grid max-w-7xl grid-cols-3 gap-2">
            <WorkspaceButton active={section === 'neon'} onClick={() => setSection('neon')}>
              Швидкий пульт
            </WorkspaceButton>
            <WorkspaceButton active={section === 'full'} onClick={() => setSection('full')}>
              Повна панель
            </WorkspaceButton>
            <WorkspaceButton active={section === 'staff'} onClick={() => setSection('staff')}>
              Персонал
            </WorkspaceButton>
          </div>
        </div>

        {section === 'neon' && <AdminNeonPanel />}
        {section === 'full' && <AdminPanel />}
        {section === 'staff' && (
          <main className="mx-auto max-w-5xl p-4 pb-28 lg:p-8">
            <AdminStaffPanel />
          </main>
        )}
      </div>
    </AdminAuthGate>
  );
}

function WorkspaceButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-2xl border px-2 py-3 text-[11px] font-black transition active:scale-[0.97] sm:text-sm ${
        active
          ? 'border-amber-200/60 bg-amber-300/15 text-amber-100 shadow-[0_0_24px_rgba(251,191,36,.14)]'
          : 'border-white/10 bg-neutral-900 text-white/55'
      }`}
    >
      {children}
    </button>
  );
}
