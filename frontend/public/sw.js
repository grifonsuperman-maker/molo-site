// Network-only worker: never cache pages, booking data, API responses or polling.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});

// Subscription and authenticated delivery are deliberately handled in a separate change.
const notificationCategories = Object.freeze({
  booking: 'Бронювання',
  review_reply: 'Відповідь на відгук',
  restaurant_status: 'Повідомлення ресторану',
  broadcast: 'Новини MOLO',
});

function readablePushNotification(event) {
  if (!event.data) return null;
  try {
    const payload = event.data.json();
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
    if (!Object.prototype.hasOwnProperty.call(notificationCategories, payload.category)) return null;
    if (typeof payload.body !== 'string') return null;
    const body = payload.body.trim();
    if (!body || body.length > 500) return null;
    return { title: `MOLO · ${notificationCategories[payload.category]}`, body };
  } catch {
    return null;
  }
}

self.addEventListener('push', (event) => {
  const notification = readablePushNotification(event);
  if (!notification) return;
  event.waitUntil(self.registration.showNotification(notification.title, {
    body: notification.body,
    icon: '/pwa-icon-192.png',
    badge: '/pwa-icon-192.png',
    data: { url: '/' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const guestWindow = windows.find((client) => {
      try {
        const url = new URL(client.url);
        return url.origin === self.location.origin && url.pathname === '/' &&
          !url.search && (!url.hash || url.hash === '#guest');
      } catch {
        return false;
      }
    });
    if (guestWindow) return guestWindow.focus();
    return self.clients.openWindow('/');
  })());
});
