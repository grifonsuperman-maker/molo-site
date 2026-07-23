import { useEffect } from 'react';

import { bookingsApi } from '../api/bookings';
import type { GuestBookingToken } from '../api/bookings';

const ACTIVE_BOOKING_STORAGE_KEY = 'molo:guest:active-booking-id';
const GUEST_BOOKINGS_STORAGE_KEY = 'molo:guest:bookings:v1';
const GUEST_DEVICE_ID_STORAGE_KEY = 'molo:guest:device-id:v1';
const DISMISSED_REVIEW_STORAGE_KEY = 'molo:guest:dismissed-reviews:v1';
const EXTERNAL_REVIEW_SESSION_KEY_PREFIX = 'molo:guest:external-review-opened:';
const MAX_STORED_ITEMS = 100;

function readStringArray(key: string): string[] {
  if (typeof window === 'undefined') return [];

  try {
    const value = JSON.parse(window.localStorage.getItem(key) || '[]');
    if (!Array.isArray(value)) return [];
    return [...new Set(value.filter((item): item is string => typeof item === 'string' && Boolean(item)))].slice(0, MAX_STORED_ITEMS);
  } catch {
    return [];
  }
}

function readGuestBookings(): GuestBookingToken[] {
  if (typeof window === 'undefined') return [];

  try {
    const value = JSON.parse(window.localStorage.getItem(GUEST_BOOKINGS_STORAGE_KEY) || '[]');
    if (!Array.isArray(value)) return [];

    return value.filter((item): item is GuestBookingToken =>
      typeof item?.bookingId === 'string' && Boolean(item.bookingId) &&
      typeof item?.token === 'string' && Boolean(item.token) &&
      typeof item?.createdAt === 'string' && Boolean(item.createdAt),
    ).slice(0, MAX_STORED_ITEMS);
  } catch {
    return [];
  }
}

function pruneDismissedReviewBookings() {
  if (typeof window === 'undefined') return;

  try {
    const dismissedIds = new Set(readStringArray(DISMISSED_REVIEW_STORAGE_KEY));
    if (dismissedIds.size === 0) return;

    const storedBookings = readGuestBookings();
    const remainingBookings = storedBookings.filter((booking) => !dismissedIds.has(booking.bookingId));

    if (remainingBookings.length !== storedBookings.length) {
      window.localStorage.setItem(GUEST_BOOKINGS_STORAGE_KEY, JSON.stringify(remainingBookings));
    }

    const activeBookingId = window.localStorage.getItem(ACTIVE_BOOKING_STORAGE_KEY);
    if (activeBookingId && dismissedIds.has(activeBookingId)) {
      window.localStorage.removeItem(ACTIVE_BOOKING_STORAGE_KEY);
    }

    dismissedIds.forEach((bookingId) => {
      window.sessionStorage.removeItem(`${EXTERNAL_REVIEW_SESSION_KEY_PREFIX}${bookingId}`);
    });
  } catch {
    // Закриття відгуку не повинно ламати гостьовий режим без доступу до сховища.
  }
}

function persistDismissedReviews(bookingIds: string[]) {
  if (typeof window === 'undefined' || bookingIds.length === 0) return;

  try {
    const dismissedIds = [...new Set([
      ...bookingIds,
      ...readStringArray(DISMISSED_REVIEW_STORAGE_KEY),
    ])].slice(0, MAX_STORED_ITEMS);

    window.localStorage.setItem(DISMISSED_REVIEW_STORAGE_KEY, JSON.stringify(dismissedIds));
    pruneDismissedReviewBookings();
  } catch {
    // Відсутність localStorage не заважає гостю закрити поточне вікно.
  }
}

async function findCompletedBookingIds() {
  const storedBookings = readGuestBookings();
  const guestDeviceId = window.localStorage.getItem(GUEST_DEVICE_ID_STORAGE_KEY) || '';

  if (!guestDeviceId && storedBookings.length === 0) return [];

  const bookings = await bookingsApi.guestList(
    guestDeviceId,
    storedBookings.map((booking) => booking.token),
  );

  return bookings
    .filter((booking) => booking.status === 'completed')
    .map((booking) => booking.bookingId);
}

function isMyBookingsClose(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;

  const button = target.closest('button');
  if (!button) return false;

  const dialog = button.closest('[role="dialog"][aria-label="Мої бронювання"]');
  if (!dialog) return false;

  return button.getAttribute('aria-label') === 'Закрити мої бронювання' ||
    button.textContent?.trim() === 'Закрити';
}

// Застосовуємо попередні відмови до того, як GuestApp прочитає збережені токени.
pruneDismissedReviewBookings();

export default function GuestReviewDismissController() {
  useEffect(() => {
    let stopped = false;
    let dismissing = false;
    let completedIdsPromise = findCompletedBookingIds().catch(() => [] as string[]);

    async function handleClick(event: MouseEvent) {
      if (dismissing || !isMyBookingsClose(event.target)) return;
      dismissing = true;

      try {
        let completedIds = await completedIdsPromise;
        if (stopped) return;

        // Статус міг змінитися після початкового завантаження контролера.
        if (completedIds.length === 0) {
          completedIds = await findCompletedBookingIds().catch(() => [] as string[]);
        }
        if (stopped || completedIds.length === 0) return;

        persistDismissedReviews(completedIds);
        window.setTimeout(() => window.location.reload(), 0);
      } finally {
        dismissing = false;
      }
    }

    document.addEventListener('click', handleClick, true);

    return () => {
      stopped = true;
      completedIdsPromise = Promise.resolve([]);
      document.removeEventListener('click', handleClick, true);
    };
  }, []);

  return null;
}
