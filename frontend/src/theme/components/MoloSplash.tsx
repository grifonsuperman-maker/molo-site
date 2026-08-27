import { useEffect, useState } from 'react';

const SPLASH_HOLD_MS = 1500;
const SPLASH_EXIT_MS = 450;

export default function MoloSplash() {
  const [phase, setPhase] = useState<'visible' | 'leaving' | 'hidden'>('visible');

  useEffect(() => {
    const leaveTimer = window.setTimeout(() => setPhase('leaving'), SPLASH_HOLD_MS);
    const hideTimer = window.setTimeout(
      () => setPhase('hidden'),
      SPLASH_HOLD_MS + SPLASH_EXIT_MS,
    );

    return () => {
      window.clearTimeout(leaveTimer);
      window.clearTimeout(hideTimer);
    };
  }, []);

  if (phase === 'hidden') return null;

  return (
    <div
      className={`molo-splash ${phase === 'leaving' ? 'molo-splash--leaving' : ''}`}
      role="status"
      aria-label="Завантаження MOLO"
    >
      <div className="molo-splash__halo" aria-hidden="true" />
      <img
        src="/logo.png"
        alt=""
        className="molo-splash__logo"
        draggable={false}
      />
      <span className="sr-only">Завантаження MOLO</span>
    </div>
  );
}
