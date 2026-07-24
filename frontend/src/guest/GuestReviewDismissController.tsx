import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import { bookingsApi, type GuestBooking, type GuestBookingToken } from '../api/bookings';

const GUEST_BOOKINGS_STORAGE_KEY = 'molo:guest:bookings:v1';
const ACTIVE_BOOKING_STORAGE_KEY = 'molo:guest:active-booking-id';
const DISMISSED_REVIEW_STORAGE_KEY = 'molo:guest:dismissed-review-bookings:v1';
const INTERNAL_REVIEW_PROMPT = 'Поділіться враженнями від візиту';
const INTERNAL_REVIEW_TITLE = 'Залиште відгук про ваш відпочинок у MOLO';

type Listener = (bookings: GuestBooking[]) => void;

let latestRawBookings: GuestBooking[] = [];
let latestVisibleBookings: GuestBooking[] = [];
const listeners = new Set<Listener>();
const originalGuestList = bookingsApi.guestList;

function availableStorages() {
  if (typeof window === 'undefined') return [] as Storage[];
  const storages: Storage[] = [];

  try {
    storages.push(window.localStorage);
  } catch {}

  try {
    storages.push(window.sessionStorage);
  } catch {}

  return storages;
}

function readDismissedIds() {
  const ids = new Set<string>();

  for (const storage of availableStorages()) {
    try {
      const parsed = JSON.parse(storage.getItem(DISMISSED_REVIEW_STORAGE_KEY) || '[]');
      if (Array.isArray(parsed)) {
        parsed.forEach((value) => {
          if (typeof value === 'string' && value) ids.add(value);
        });
      }
    } catch {}
  }

  return ids;
}

const dismissedIds = readDismissedIds();

function persistDismissedIds() {
  const payload = JSON.stringify([...dismissedIds]);

  for (const storage of availableStorages()) {
    try {
      storage.setItem(DISMISSED_REVIEW_STORAGE_KEY, payload);
    } catch {}
  }
}

function latestReviewCandidate(bookings: GuestBooking[]) {
  return bookings.find(
    (booking) =>
      booking.status === 'completed' &&
      booking.canLeaveReview &&
      !dismissedIds.has(booking.bookingId),
  ) || null;
}

function filterGuestHistory(bookings: GuestBooking[]) {
  const candidate = latestReviewCandidate(bookings);

  return bookings.filter((booking) => {
    if (booking.status !== 'completed') return true;
    return Boolean(candidate && booking.bookingId === candidate.bookingId);
  });
}

function publish(bookings: GuestBooking[]) {
  latestVisibleBookings = bookings;
  listeners.forEach((listener) => listener(bookings));

  if (typeof window !== 'undefined') {
    window.setTimeout(() => hideDismissedUi(bookings), 0);
  }
}

function subscribe(listener: Listener) {
  listeners.add(listener);
  listener(latestVisibleBookings);

  return () => {
    listeners.delete(listener);
  };
}

function removeStoredTokens(bookingIds: Set<string>) {
  if (typeof window === 'undefined' || bookingIds.size === 0) return;

  try {
    const parsed = JSON.parse(window.localStorage.getItem(GUEST_BOOKINGS_STORAGE_KEY) || '[]');
    if (Array.isArray(parsed)) {
      const next = parsed.filter(
        (item: GuestBookingToken) =>
          typeof item?.bookingId !== 'string' || !bookingIds.has(item.bookingId),
      );
      window.localStorage.setItem(GUEST_BOOKINGS_STORAGE_KEY, JSON.stringify(next));
    }

    const activeBookingId = window.localStorage.getItem(ACTIVE_BOOKING_STORAGE_KEY);
    if (activeBookingId && bookingIds.has(activeBookingId)) {
      window.localStorage.removeItem(ACTIVE_BOOKING_STORAGE_KEY);
    }
  } catch {
    // The in-memory filter still works when browser storage is unavailable.
  }
}

function hideDismissedUi(bookings: GuestBooking[]) {
  if (typeof document === 'undefined') return;

  const dialog = document.querySelector<HTMLElement>(
    '[role="dialog"][aria-label="Мої бронювання"]',
  );
  const reviewSection = dialog
    ? Array.from(dialog.querySelectorAll<HTMLElement>('section')).find(
        (section) => section.textContent?.includes(INTERNAL_REVIEW_TITLE),
      ) || null
    : null;

  const reviewCandidate = latestReviewCandidate(bookings);
  if (reviewSection) reviewSection.style.display = reviewCandidate ? '' : 'none';

  const hasVisibleBooking = Boolean(reviewCandidate) || bookings.some(
    (booking) =>
      booking.status === 'pending' ||
      booking.status === 'approved' ||
      (booking.status === 'cancelled' &&
        Boolean(booking.guestNotification) &&
        !booking.guestNotification?.acknowledgedAt),
  );

  if (dialog) dialog.style.display = hasVisibleBooking ? '' : 'none';

  document.querySelectorAll<HTMLElement>('aside').forEach((aside) => {
    if (aside.textContent?.includes('Мої бронювання')) {
      aside.style.display = hasVisibleBooking ? '' : 'none';
    }
  });
}

function dismissReview(bookingId?: string | null) {
  const target = bookingId
    ? latestRawBookings.find((booking) => booking.bookingId === bookingId) || null
    : latestReviewCandidate(latestRawBookings);

  if (!target) return;

  const completedIds = latestRawBookings
    .filter((booking) => booking.status === 'completed')
    .map((booking) => booking.bookingId);
  completedIds.forEach((id) => dismissedIds.add(id));
  dismissedIds.add(target.bookingId);
  persistDismissedIds();

  // Прибираємо доступ лише до відхиленого візиту. Токени інших завершених
  // бронювань не видаляємо, навіть якщо їхня історія прихована в інтерфейсі.
  removeStoredTokens(new Set([target.bookingId]));

  const visible = filterGuestHistory(latestRawBookings);
  publish(visible);
}

bookingsApi.guestList = async (guestDeviceId: string, tokens: string[] = []) => {
  const bookings = await originalGuestList(guestDeviceId, tokens);
  latestRawBookings = bookings;
  const visible = filterGuestHistory(bookings);
  publish(visible);
  return visible;
};

if (typeof window !== 'undefined') {
  const promptWindow = window as typeof window & {
    __moloReviewDismissPromptWrapped?: boolean;
  };

  if (!promptWindow.__moloReviewDismissPromptWrapped) {
    const originalPrompt = window.prompt.bind(window);
    window.prompt = (message?: string, defaultValue?: string) => {
      const result = originalPrompt(message, defaultValue);

      if (
        String(message || '') === INTERNAL_REVIEW_PROMPT &&
        (!result || !result.trim())
      ) {
        dismissReview();
      }

      return result;
    };
    promptWindow.__moloReviewDismissPromptWrapped = true;
  }
}

export default function GuestReviewDismissController() {
  const [bookings, setBookings] = useState<GuestBooking[]>(latestVisibleBookings);
  const [reviewTarget, setReviewTarget] = useState<HTMLElement | null>(null);

  useEffect(() => subscribe(setBookings), []);

  useEffect(() => {
    function syncReviewTarget() {
      const dialog = document.querySelector<HTMLElement>(
        '[role="dialog"][aria-label="Мої бронювання"]',
      );
      const target = dialog
        ? Array.from(dialog.querySelectorAll<HTMLElement>('section')).find(
            (section) => section.textContent?.includes(INTERNAL_REVIEW_TITLE),
          ) || null
        : null;
      setReviewTarget(target);
      hideDismissedUi(latestVisibleBookings);
    }

    function handleDialogClose(event: MouseEvent) {
      const button = (event.target as Element | null)?.closest('button');
      if (!button) return;

      const closesDialog =
        button.textContent?.trim() === 'Закрити' ||
        button.getAttribute('aria-label') === 'Закрити мої бронювання';
      if (!closesDialog) return;
      if (!button.closest('[role="dialog"][aria-label="Мої бронювання"]')) return;
      if (!latestReviewCandidate(latestRawBookings)) return;
      dismissReview();
    }

    syncReviewTarget();
    const observer = new MutationObserver(syncReviewTarget);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('click', handleDialogClose, true);

    return () => {
      observer.disconnect();
      document.removeEventListener('click', handleDialogClose, true);
    };
  }, []);

  const candidate = useMemo(() => latestReviewCandidate(bookings), [bookings]);
  if (!reviewTarget || !candidate) return null;

  return createPortal(
    <button
      type="button"
      onClick={() => dismissReview(candidate.bookingId)}
      className="mt-3 ml-2 rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm font-bold text-white/65 transition active:scale-[0.98]"
    >
      Не залишати відгук
    </button>,
    reviewTarget,
  );
}
