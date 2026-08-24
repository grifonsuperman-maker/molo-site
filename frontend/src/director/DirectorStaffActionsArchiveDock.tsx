import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { StaffActionsArchiveButton } from './DirectorStaffActionsArchiveControls';

function findStaffActionsSection(): HTMLElement | null {
  const heading = Array.from(document.querySelectorAll<HTMLHeadingElement>('h1'))
    .find((item) => item.textContent?.trim() === 'Дії персоналу');
  return heading?.closest('section') || null;
}

function refreshDirectorPanel() {
  document
    .querySelector<HTMLButtonElement>('button[aria-label="Оновити"]')
    ?.click();
}

export default function DirectorStaffActionsArchiveDock() {
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    let host: HTMLDivElement | null = null;

    function syncTarget() {
      const activitySection = findStaffActionsSection();

      if (!activitySection) {
        if (host) host.remove();
        host = null;
        setTarget(null);
        return;
      }

      if (host?.parentElement === activitySection) return;

      if (host) host.remove();
      host = document.createElement('div');
      host.dataset.directorStaffActionsArchive = 'true';
      host.className = 'mt-3';
      activitySection.appendChild(host);
      setTarget(host);
    }

    syncTarget();
    const observer = new MutationObserver(syncTarget);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      if (host) host.remove();
    };
  }, []);

  if (!target) return null;

  return createPortal(
    <section className="rounded-[24px] border border-cyan-100/15 bg-black/45 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,.035),0_0_28px_rgba(103,232,249,.055),0_18px_50px_rgba(0,0,0,.28)] backdrop-blur-xl">
      <p className="text-[10px] font-black uppercase tracking-[0.22em] text-cyan-100/45">
        Дії персоналу
      </p>
      <h2 className="mt-1 text-xl font-black">Керування архівом</h2>
      <p className="mt-2 text-sm text-white/45">
        Архівуйте старі записи. Остаточне видалення доступне Директору тільки з архіву.
      </p>
      <div className="mt-4">
        <StaffActionsArchiveButton onChanged={refreshDirectorPanel} />
      </div>
    </section>,
    target,
  );
}
