import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { readGuestBrowserAccess } from '../../api/guestAccessRuntime';
import { isDeveloperRoleSwitcherPath } from '../../developer/developerRoleSwitcher';
import { isTelegramMiniApp } from '../../telegram/telegramRuntime';
import { readTelegramStaffInviteToken } from '../../telegram/TelegramStaffLinkGate';

type PushConfig = { enabled?: boolean; vapidPublicKey?: string };

const DISMISSED_AT_KEY = 'molo:push:opt-in-dismissed-at:v1';
const DISMISS_FOR_MS = 30 * 24 * 60 * 60 * 1000;

function isInstalled() {
  return window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function isGuestHomeVisible() {
  return Boolean(document.querySelector('section.molo-screen .molo-site-mode-badge'));
}

function isGuestContext() {
  const hash = window.location.hash.replace('#', '');
  return !['waiter', 'hookah', 'admin', 'director'].includes(hash) &&
    !isTelegramMiniApp() && !readTelegramStaffInviteToken() &&
    !isDeveloperRoleSwitcherPath(window.location.pathname);
}

function hasPushSupport() {
  return window.isSecureContext && 'serviceWorker' in navigator &&
    'PushManager' in window && 'Notification' in window &&
    Notification.permission !== 'denied';
}

function wasRecentlyDismissed() {
  try {
    const timestamp = Number(window.localStorage.getItem(DISMISSED_AT_KEY));
    return timestamp > 0 && Date.now() - timestamp < DISMISS_FOR_MS;
  } catch {
    return false;
  }
}

function decodeVapidPublicKey(key: string): Uint8Array | null {
  // A P-256 uncompressed public key is exactly 65 bytes (87 base64url characters).
  if (!/^[A-Za-z0-9_-]{87}$/.test(key)) return null;
  try {
    const padded = key.replace(/-/g, '+').replace(/_/g, '/') + '=';
    const decoded = atob(padded);
    if (decoded.length !== 65 || decoded.charCodeAt(0) !== 4) return null;
    return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

export default function GuestPushOptIn() {
  const [onGuestHome, setOnGuestHome] = useState(isGuestHomeVisible);
  const [inGuestContext, setInGuestContext] = useState(isGuestContext);
  const [installed, setInstalled] = useState(isInstalled);
  const [hasBookingAccess, setHasBookingAccess] = useState(
    () => readGuestBrowserAccess().bookings.length > 0,
  );
  const [dismissed, setDismissed] = useState(wasRecentlyDismissed);
  const [vapidKey, setVapidKey] = useState('');
  const [working, setWorking] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const refreshContext = () => {
      setOnGuestHome(isGuestHomeVisible());
      setInGuestContext(isGuestContext());
      setHasBookingAccess(readGuestBrowserAccess().bookings.length > 0);
      setInstalled(isInstalled());
    };
    const root = document.getElementById('root');
    const observer = root ? new MutationObserver(refreshContext) : null;
    if (root) observer?.observe(root, { childList: true, subtree: true });
    window.addEventListener('hashchange', refreshContext);
    window.addEventListener('appinstalled', refreshContext);
    window.addEventListener('pageshow', refreshContext);
    refreshContext();
    return () => {
      observer?.disconnect();
      window.removeEventListener('hashchange', refreshContext);
      window.removeEventListener('appinstalled', refreshContext);
      window.removeEventListener('pageshow', refreshContext);
    };
  }, []);

  useEffect(() => {
    // Never keep an enabled key across a changed guest context or readiness check.
    setVapidKey('');
    if (!onGuestHome || !inGuestContext || !installed || !hasBookingAccess ||
      !hasPushSupport() || dismissed || completed) return;
    let cancelled = false;
    // No server endpoint or public VAPID key yet: no button and no permission request.
    void api.get<PushConfig>('/push/guest/config').then((config) => {
      if (cancelled) return;
      const key = config?.enabled === true &&
        typeof config.vapidPublicKey === 'string' &&
        decodeVapidPublicKey(config.vapidPublicKey)
        ? config.vapidPublicKey : '';
      setVapidKey(key);
    }).catch(() => { if (!cancelled) setVapidKey(''); });
    return () => { cancelled = true; };
  }, [onGuestHome, inGuestContext, installed, hasBookingAccess, dismissed, completed]);

  function dismiss() {
    try {
      window.localStorage.setItem(DISMISSED_AT_KEY, String(Date.now()));
    } catch {
      // Dismiss for this tab even when storage is unavailable.
    }
    setDismissed(true);
  }

  async function enableNotifications() {
    if (!vapidKey || working || !isGuestContext() || !isInstalled() ||
      !isGuestHomeVisible() || !hasPushSupport()) return;
    const access = readGuestBrowserAccess();
    const booking = access.bookings[0];
    if (!booking) return;

    setWorking(true);
    setError('');
    try {
      // The permission request starts directly from the guest's button click (iOS requirement).
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setError('Сповіщення не дозволено. Дозвіл можна змінити в налаштуваннях пристрою.');
        return;
      }
      const key = decodeVapidPublicKey(vapidKey);
      if (!key) throw new Error('Invalid push configuration');
      const worker = await navigator.serviceWorker.register('/sw.js');
      const existing = await worker.pushManager.getSubscription();
      const existingServerKey = existing?.options.applicationServerKey;
      const previousKey = existingServerKey ? new Uint8Array(existingServerKey as ArrayBuffer) : null;
      const keyMatches = Boolean(previousKey && previousKey.length === key.length &&
        previousKey.every((byte, index) => byte === key[index]));
      if (existing && !keyMatches) await existing.unsubscribe();
      const subscription = existing && keyMatches ? existing : await worker.pushManager.subscribe({
        userVisibleOnly: true,
        // Uint8Array.from above allocates an ArrayBuffer, never a SharedArrayBuffer.
        applicationServerKey: key as Uint8Array<ArrayBuffer>,
      });
      // A booking access token proves ownership; the backend must validate it,
      // hash guestDeviceId, and never include tokens in notification payloads.
      const result = await api.post<{ enabled?: boolean }>('/push/guest/subscriptions', {
        guestDeviceId: access.guestDeviceId,
        bookingId: booking.bookingId,
        guestAccessToken: booking.token,
        subscription: subscription.toJSON(),
      });
      if (result?.enabled !== true) throw new Error('Push registration was not confirmed');
      setCompleted(true);
    } catch {
      setError('Не вдалося підключити сповіщення. Спробуйте ще раз пізніше.');
    } finally {
      setWorking(false);
    }
  }

  if (!vapidKey || !onGuestHome || !inGuestContext || !installed || !hasBookingAccess ||
    !hasPushSupport() || dismissed || completed) return null;

  return (
    <aside aria-label="Сповіщення MOLO" className="fixed bottom-[calc(env(safe-area-inset-bottom)+12px)] left-1/2 z-[65] w-[calc(100%-24px)] max-w-sm -translate-x-1/2 rounded-2xl border border-amber-300/50 bg-[#141414]/95 p-3 text-left text-white shadow-2xl backdrop-blur-md">
      <div className="flex items-start gap-3">
        <img src="/pwa-icon-192.png" alt="" className="h-12 w-12 shrink-0 rounded-xl bg-white object-contain" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Сповіщення MOLO</p>
          <p className="mt-1 text-xs text-white/80">Дізнавайтеся про зміни ваших бронювань.</p>
        </div>
        <button type="button" onClick={dismiss} aria-label="Закрити пропозицію сповіщень" className="rounded-lg px-2 py-1 text-lg text-white/80">×</button>
      </div>
      <button type="button" disabled={working} onClick={() => { void enableNotifications(); }} className="mt-3 w-full rounded-xl bg-amber-200 px-4 py-2.5 text-sm font-semibold text-neutral-950 disabled:opacity-60">
        {working ? 'Зачекайте…' : 'Увімкнути сповіщення'}
      </button>
      {error && <p role="status" className="mt-2 text-xs text-white/90">{error}</p>}
    </aside>
  );
}
