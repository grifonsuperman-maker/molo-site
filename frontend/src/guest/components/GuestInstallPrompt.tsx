import { useEffect, useRef, useState } from 'react';
import { isDeveloperRoleSwitcherPath } from '../../developer/developerRoleSwitcher';
import { isTelegramMiniApp } from '../../telegram/telegramRuntime';
import { readTelegramStaffInviteToken } from '../../telegram/TelegramStaffLinkGate';

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

// Guest Push is live in production, so the install invitation can be shown on the guest home screen.
const INSTALL_INVITATION_ENABLED = true;
const DISMISSED_AT_KEY = 'molo:pwa:install-dismissed-at:v2';
const DISMISS_FOR_MS = 30 * 24 * 60 * 60 * 1000;

function isInstalled() {
  return window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function wasRecentlyDismissed() {
  try {
    const timestamp = Number(window.localStorage.getItem(DISMISSED_AT_KEY));
    return timestamp > 0 && Date.now() - timestamp < DISMISS_FOR_MS;
  } catch {
    return false;
  }
}

function isGuestRoute() {
  const hash = window.location.hash.replace('#', '');
  return !['waiter', 'hookah', 'admin', 'director'].includes(hash);
}

function isGuestHomeVisible() {
  // Stable home-only element: title rotation can replace /hero-bg.jpg at runtime.
  return Boolean(document.querySelector('section.molo-screen .molo-site-mode-badge'));
}

export default function GuestInstallPrompt() {
  const deferredPrompt = useRef<InstallPromptEvent | null>(null);
  const [isHome, setIsHome] = useState(isGuestHomeVisible);
  const [guestRoute, setGuestRoute] = useState(isGuestRoute);
  const eligible = guestRoute && !isTelegramMiniApp() &&
    !readTelegramStaffInviteToken() &&
    !isDeveloperRoleSwitcherPath(window.location.pathname);
  const [hidden, setHidden] = useState(() => isInstalled() || wasRecentlyDismissed());
  const [canPrompt, setCanPrompt] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const [installing, setInstalling] = useState(false);
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/i.test(navigator.userAgent);

  useEffect(() => {
    const onHashChange = () => setGuestRoute(isGuestRoute());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    if (!eligible) return;
    const root = document.getElementById('root');
    if (!root) return;

    const updateHome = () => setIsHome(isGuestHomeVisible());
    updateHome();
    const observer = new MutationObserver(updateHome);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [eligible]);

  useEffect(() => {
    if (!eligible) return;
    if ('serviceWorker' in navigator) {
      // Network-only worker; booking requests and the 15-second polling are never cached.
      void navigator.serviceWorker.register('/sw.js').catch(() => {});
    }

    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      deferredPrompt.current = event as InstallPromptEvent;
      setCanPrompt(true);
    };
    const onInstalled = () => {
      deferredPrompt.current = null;
      setCanPrompt(false);
      setHidden(true);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, [eligible]);

  function dismiss() {
    try {
      window.localStorage.setItem(DISMISSED_AT_KEY, String(Date.now()));
    } catch {
      // The dismissal still works for the current page without localStorage.
    }
    setHidden(true);
  }

  async function install() {
    const prompt = deferredPrompt.current;
    if (!prompt) {
      setShowInstructions((current) => !current);
      return;
    }

    deferredPrompt.current = null;
    setCanPrompt(false);
    setInstalling(true);
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome === 'accepted') setHidden(true);
    } catch {
      setShowInstructions(true);
    } finally {
      setInstalling(false);
    }
  }

  if (!INSTALL_INVITATION_ENABLED || hidden || !eligible || !isHome) return null;

  return (
    <aside
      aria-label="Встановлення MOLO"
      className="fixed bottom-[calc(env(safe-area-inset-bottom)+12px)] left-1/2 z-[65] w-[calc(100%-24px)] max-w-sm -translate-x-1/2 rounded-2xl border border-amber-300/50 bg-[#141414]/95 p-3 text-left text-white shadow-2xl backdrop-blur-md"
    >
      <div className="flex items-start gap-3">
        <img src="/pwa-icon-192.png" alt="" className="h-12 w-12 shrink-0 rounded-xl bg-white object-contain" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Встановіть MOLO</p>
          <p className="mt-1 text-xs text-white/80">Швидкий доступ до бронювань та майбутніх сповіщень.</p>
        </div>
        <button type="button" onClick={dismiss} aria-label="Закрити пропозицію встановлення" className="rounded-lg px-2 py-1 text-lg text-white/80" >×</button>
      </div>
      <button
        type="button"
        disabled={installing}
        onClick={() => { void install(); }}
        className="mt-3 w-full rounded-xl bg-amber-200 px-4 py-2.5 text-sm font-semibold text-neutral-950 disabled:opacity-60"
      >
        {installing ? 'Зачекайте…' : canPrompt ? 'Встановити MOLO' : 'Як встановити MOLO'}
      </button>
      {showInstructions && (
        <p className="mt-2 text-xs leading-relaxed text-white/90" role="status">
          {isIOS
            ? 'Відкрийте MOLO у Safari → Поділитися → На початковий екран → Додати.'
            : isAndroid
              ? 'Відкрийте MOLO у Chrome → меню ⋮ → Встановити застосунок або Додати на головний екран.'
              : 'У Chrome або Edge відкрийте меню браузера та виберіть встановлення MOLO.'}
        </p>
      )}
    </aside>
  );
}
