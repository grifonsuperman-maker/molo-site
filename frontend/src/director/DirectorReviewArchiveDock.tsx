import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { ReviewArchiveButton } from './DirectorReviewArchiveControls';

function findReviewSection(): HTMLElement | null {
  return document.getElementById('director-reviews');
}

function refreshDirectorPanel() {
  document
    .querySelector<HTMLButtonElement>('button[aria-label="Оновити"]')
    ?.click();
}

export default function DirectorReviewArchiveDock() {
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    let host: HTMLDivElement | null = null;

    function syncTarget() {
      const reviewSection = findReviewSection();

      if (!reviewSection) {
        if (host) host.remove();
        host = null;
        setTarget(null);
        return;
      }

      if (host?.parentElement === reviewSection) return;

      if (host) host.remove();
      host = document.createElement('div');
      host.dataset.directorReviewArchive = 'true';
      host.className = 'mt-3';
      reviewSection.appendChild(host);
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
    <section className="rounded-[24px] border border-amber-100/15 bg-black/45 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,.035),0_0_28px_rgba(251,191,36,.055),0_18px_50px_rgba(0,0,0,.28)] backdrop-blur-xl">
      <p className="text-[10px] font-black uppercase tracking-[0.22em] text-amber-100/45">
        Письмові відгуки
      </p>
      <h2 className="mt-1 text-xl font-black">Керування архівом</h2>
      <p className="mt-2 text-sm text-white/45">
        Архівуйте старі відгуки або відкрийте архів для відновлення та остаточного видалення.
      </p>
      <div className="mt-4">
        <ReviewArchiveButton onChanged={refreshDirectorPanel} />
      </div>
    </section>,
    target,
  );
}
