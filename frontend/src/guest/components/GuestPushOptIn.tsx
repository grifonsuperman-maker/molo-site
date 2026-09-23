import { useEffect, useRef, useState } from 'react';
import { bookingsApi } from '../../api/bookings';
import { api } from '../../api/client';
import { readGuestBrowserAccess } from '../../api/guestAccessRuntime';
import { isDeveloperRoleSwitcherPath } from '../../developer/developerRoleSwitcher';
import { isTelegramMiniApp } from '../../telegram/telegramRuntime';
import { readTelegramStaffInviteToken } from '../../telegram/TelegramStaffLinkGate';

type PushConfig = { enabled?: boolean; vapidPublicKey?: string };

const DISMISSED_AT_KEY = 'molo:push:opt-in-dismissed-at:v1';
const CONFIRMED_SUBSCRIPTION_KEY = 'molo:push:confirmed-subscription:v1';
const DISMISS_FOR_MS = 30 * 24 * 60 * 60 * 1000;
const PERMISSION_DENIED_MESSAGE = 'Сповіщення не дозволено. Дозвіл можна змінити в налаштуваннях пристрою.';

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

async function isValidVapidPublicKey(key: string) {
  const bytes = decodeVapidPublicKey(key);
  if (!bytes) return false;
  try {
    // Length and prefix alone do not prove that this is a usable P-256 point.
    await crypto.subtle.importKey('raw', bytes as Uint8Array<ArrayBuffer>,
      { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    return true;
  } catch {
    return false;
  }
}

function subscriptionMatchesKey(subscription: PushSubscription | null, key: Uint8Array) {
  const applicationServerKey = subscription?.options.applicationServerKey;
  if (!applicationServerKey) return false;
  const previousKey = new Uint8Array(applicationServerKey as ArrayBuffer);
  return previousKey.length === key.length &&
    previousKey.every((byte, index) => byte === key[index]);
}

type GuestBrowserAccess = ReturnType<typeof readGuestBrowserAccess>;

function guestPushKyivDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value || '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function guestBookingAccessKey(access: GuestBrowserAccess) {
  return [...new Set(access.bookings.map((booking) => booking.bookingId))].sort().join('|');
}

async function resolveActiveBookingAccess(access: GuestBrowserAccess) {
  if (access.bookings.length === 0) return [];
  const bookings = await bookingsApi.guestList(
    access.guestDeviceId,
    access.bookings.map((booking) => booking.token),
  );
  const today = guestPushKyivDate();
  const activeIds = new Set(
    bookings
      .filter(
        (booking) =>
          (booking.status === 'pending' || booking.status === 'approved') &&
          booking.bookingDate >= today,
      )
      .map((booking) => booking.bookingId),
  );
  return access.bookings.filter((booking) => activeIds.has(booking.bookingId));
}

async function subscriptionFingerprint(bookingId: string, publicKey: string, endpoint: string) {
  // Do not persist private guest booking tokens or the raw push endpoint.
  const data = new TextEncoder().encode(`${bookingId}\n${publicKey}\n${endpoint}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

const CONFIRMED_FINGERPRINT = /^[a-f0-9]{64}$/;
let runtimeConfirmedFingerprints = new Set<string>();

function parseConfirmedFingerprints(stored: string | null) {
  if (!stored) return [] as string[];

  // The v1 key already exists in production as a single SHA-256 fingerprint.
  // Keep that value valid while migrating storage to the per-booking array shape.
  if (CONFIRMED_FINGERPRINT.test(stored)) return [stored];

  try {
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed)
      ? parsed.filter(
          (value): value is string =>
            typeof value === 'string' && CONFIRMED_FINGERPRINT.test(value),
        )
      : [];
  } catch {
    return [];
  }
}

function readConfirmedFingerprints() {
  try {
    for (const fingerprint of parseConfirmedFingerprints(
      window.localStorage.getItem(CONFIRMED_SUBSCRIPTION_KEY),
    )) {
      runtimeConfirmedFingerprints.add(fingerprint);
    }
  } catch {
    // Fall back to the confirmations retained in this tab.
  }

  return [...runtimeConfirmedFingerprints];
}

function rememberConfirmedFingerprints(fingerprints: string[]) {
  runtimeConfirmedFingerprints = new Set(
    fingerprints.filter((fingerprint) => CONFIRMED_FINGERPRINT.test(fingerprint)),
  );

  try {
    window.localStorage.setItem(
      CONFIRMED_SUBSCRIPTION_KEY,
      JSON.stringify([...runtimeConfirmedFingerprints]),
    );
  } catch {
    // Keep the confirmed set in memory while this tab remains open.
  }
}

function clearConfirmedFingerprints() {
  runtimeConfirmedFingerprints.clear();
  try {
    window.localStorage.removeItem(CONFIRMED_SUBSCRIPTION_KEY);
  } catch {
    // Browser storage is optional.
  }
}

export default function GuestPushOptIn() {
  const [onGuestHome, setOnGuestHome] = useState(isGuestHomeVisible);
  const [inGuestContext, setInGuestContext] = useState(isGuestContext);
  const [installed, setInstalled] = useState(isInstalled);
  const [hasBookingAccess, setHasBookingAccess] = useState(
    () => readGuestBrowserAccess().bookings.length > 0,
  );
  const [bookingAccessKey, setBookingAccessKey] = useState(
    () => guestBookingAccessKey(readGuestBrowserAccess()),
  );
  const [dismissed, setDismissed] = useState(wasRecentlyDismissed);
  const dismissedInTabAt = useRef(0);
  const [vapidKey, setVapidKey] = useState('');
  const [configRefresh, setConfigRefresh] = useState(0);
  const [working, setWorking] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const refreshContext = () => {
      setOnGuestHome(isGuestHomeVisible());
      setInGuestContext(isGuestContext());
      const access = readGuestBrowserAccess();
      setHasBookingAccess(access.bookings.length > 0);
      setBookingAccessKey(guestBookingAccessKey(access));
      setInstalled(isInstalled());
    };
    const refreshOnResume = () => {
      refreshContext();
      // Device settings may restore permission while this PWA is suspended.
      // Remove only the old denial guidance; preserve unrelated registration errors.
      if ('Notification' in window && Notification.permission !== 'denied') {
        setError((current) => current === PERMISSION_DENIED_MESSAGE ? '' : current);
      }
      const dismissedInTab = dismissedInTabAt.current > 0 &&
        Date.now() - dismissedInTabAt.current < DISMISS_FOR_MS;
      setDismissed(dismissedInTab || wasRecentlyDismissed());
      setConfigRefresh((current) => current + 1);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refreshOnResume();
    };
    const root = document.getElementById('root');
    const observer = root ? new MutationObserver(refreshContext) : null;
    if (root) observer?.observe(root, { childList: true, subtree: true });
    window.addEventListener('hashchange', refreshContext);
    window.addEventListener('appinstalled', refreshContext);
    window.addEventListener('pageshow', refreshOnResume);
    window.addEventListener('molo:guest-bookings-refreshed', refreshOnResume);
    document.addEventListener('visibilitychange', onVisibilityChange);
    refreshContext();
    return () => {
      observer?.disconnect();
      window.removeEventListener('hashchange', refreshContext);
      window.removeEventListener('appinstalled', refreshContext);
      window.removeEventListener('pageshow', refreshOnResume);
      window.removeEventListener('molo:guest-bookings-refreshed', refreshOnResume);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  useEffect(() => {
    // Never keep an enabled key across a changed guest context or readiness check.
    setVapidKey('');
    setCompleted(false);
    if (!onGuestHome || !inGuestContext || !installed || !hasBookingAccess ||
      !hasPushSupport() || dismissed) return;
    let cancelled = false;
    // No server endpoint or public VAPID key yet: no button and no permission request.
    void (async () => {
      const config = await api.get<PushConfig>('/push/guest/config');
      if (cancelled) return;
      const key = config?.enabled === true && typeof config.vapidPublicKey === 'string'
        ? config.vapidPublicKey : '';
      if (!key || !(await isValidVapidPublicKey(key)) || cancelled) return;

      const access = readGuestBrowserAccess();
      const activeAccess = await resolveActiveBookingAccess(access);
      if (cancelled || activeAccess.length === 0) return;

      let alreadyConfirmed = false;
      if (Notification.permission === 'granted') {
        try {
          const worker = await navigator.serviceWorker.getRegistration('/');
          const subscription = await worker?.pushManager.getSubscription();
          const decodedKey = decodeVapidPublicKey(key);
          if (subscription && decodedKey && subscriptionMatchesKey(subscription, decodedKey)) {
            const confirmedFingerprints = new Set(readConfirmedFingerprints());
            const activeFingerprints = await Promise.all(
              activeAccess.map((booking) =>
                subscriptionFingerprint(booking.bookingId, key, subscription.endpoint),
              ),
            );
            alreadyConfirmed = activeFingerprints.every((fingerprint) =>
              confirmedFingerprints.has(fingerprint),
            );
          }
        } catch {
          // A failed status lookup must never claim successful registration.
        }
      }
      if (cancelled) return;
      setCompleted(alreadyConfirmed);
      setVapidKey(key);
    })().catch(() => {
      if (!cancelled) {
        setVapidKey('');
        setCompleted(false);
      }
    });
    return () => { cancelled = true; };
  }, [
    onGuestHome,
    inGuestContext,
    installed,
    hasBookingAccess,
    bookingAccessKey,
    dismissed,
    configRefresh,
  ]);

  function dismiss() {
    dismissedInTabAt.current = Date.now();
    try {
      window.localStorage.setItem(DISMISSED_AT_KEY, String(dismissedInTabAt.current));
    } catch {
      // Dismiss for this tab even when storage is unavailable.
    }
    setDismissed(true);
  }

  async function enableNotifications() {
    if (!vapidKey || working || !isGuestContext() || !isInstalled() ||
      !isGuestHomeVisible() || !hasPushSupport()) return;
    const access = readGuestBrowserAccess();
    if (access.bookings.length === 0) return;

    setWorking(true);
    setError('');
    try {
      // The permission request starts directly from the guest's button click (iOS requirement).
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setError(PERMISSION_DENIED_MESSAGE);
        return;
      }
      const key = decodeVapidPublicKey(vapidKey);
      if (!key) throw new Error('Invalid push configuration');
      const activeAccess = await resolveActiveBookingAccess(access);
      if (activeAccess.length === 0) throw new Error('No active booking access');
      const worker = await navigator.serviceWorker.register('/sw.js');
      const existing = await worker.pushManager.getSubscription();
      const keyMatches = Boolean(existing && subscriptionMatchesKey(existing, key));
      if (existing && !keyMatches) await existing.unsubscribe();
      const subscription = existing && keyMatches ? existing : await worker.pushManager.subscribe({
        userVisibleOnly: true,
        // Uint8Array.from above allocates an ArrayBuffer, never a SharedArrayBuffer.
        applicationServerKey: key as Uint8Array<ArrayBuffer>,
      });
      // Every active booking keeps its own ownership token and booking-scoped subscription.
      // The backend hashes guestDeviceId and never includes tokens in notification payloads.
      for (const booking of activeAccess) {
        const result = await api.post<{ enabled?: boolean }>('/push/guest/subscriptions', {
          guestDeviceId: access.guestDeviceId,
          bookingId: booking.bookingId,
          guestAccessToken: booking.token,
          subscription: subscription.toJSON(),
        });
        if (result?.enabled !== true) throw new Error('Push registration was not confirmed');
      }
      const fingerprints = await Promise.all(
        activeAccess.map((booking) =>
          subscriptionFingerprint(booking.bookingId, vapidKey, subscription.endpoint),
        ),
      );
      rememberConfirmedFingerprints(fingerprints);
      setCompleted(true);
    } catch {
      clearConfirmedFingerprints();
      setError('Не вдалося підключити сповіщення. Спробуйте ще раз пізніше.');
    } finally {
      setWorking(false);
    }
  }

  // A denied permission must not hide the recovery guidance behind hasPushSupport().
  // Keep it visible even if a foreground refresh clears the server configuration.
  if (error && 'Notification' in window && Notification.permission === 'denied' &&
    onGuestHome && inGuestContext && installed && hasBookingAccess && !dismissed) {
    return (
      <aside aria-label="Сповіщення MOLO" className="fixed bottom-[calc(env(safe-area-inset-bottom)+12px)] left-1/2 z-[65] w-[calc(100%-24px)] max-w-sm -translate-x-1/2 rounded-2xl border border-amber-300/50 bg-[#141414]/95 p-3 text-left text-white shadow-2xl backdrop-blur-md">
        <p role="status" className="text-sm text-white/90">{error}</p>
        <button type="button" onClick={dismiss} className="mt-3 rounded-xl border border-amber-300/50 px-4 py-2 text-sm text-white">Закрити</button>
      </aside>
    );
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
