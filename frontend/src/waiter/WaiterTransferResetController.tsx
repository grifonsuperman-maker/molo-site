import { useEffect } from 'react';

import { bookingsApi } from '../api/bookings';
import { waiterCallsApi, type WaiterAssignment } from '../api/waiterCalls';

type PendingTransfer = {
  bookingId: string;
  tableId: string;
  expiresAt: number;
};

type PatchedWindow = typeof window & {
  __moloWaiterTransferResetPatched?: boolean;
};

let pendingTransfer: PendingTransfer | null = null;

function isPending(bookingId: string) {
  if (!pendingTransfer) return false;
  if (pendingTransfer.expiresAt < Date.now()) {
    pendingTransfer = null;
    return false;
  }
  return pendingTransfer.bookingId === bookingId;
}

if (typeof window !== 'undefined') {
  const patchedWindow = window as PatchedWindow;

  if (!patchedWindow.__moloWaiterTransferResetPatched) {
    const originalTransfer = bookingsApi.waiterTransfer.bind(bookingsApi);
    const originalCheckIn = bookingsApi.checkIn.bind(bookingsApi);
    const originalAssign = waiterCallsApi.assign.bind(waiterCallsApi);

    bookingsApi.waiterTransfer = async (bookingId: string, tableId: string) => {
      const result = await originalTransfer(bookingId, tableId);
      pendingTransfer = {
        bookingId,
        tableId,
        expiresAt: Date.now() + 10_000,
      };
      return result;
    };

    bookingsApi.checkIn = async (bookingId: string) => {
      if (isPending(bookingId)) {
        return {
          message: 'Після пересадки повторно позначте прихід гостя',
        };
      }

      return originalCheckIn(bookingId);
    };

    waiterCallsApi.assign = async (payload) => {
      if (isPending(payload.bookingId)) {
        const transfer = pendingTransfer;
        pendingTransfer = null;

        const assignment: WaiterAssignment = {
          bookingId: payload.bookingId,
          tableId: payload.tableId || transfer?.tableId || null,
          tableNumber: payload.tableNumber || null,
          waiterId: '',
          waiterName: '',
          assignedAt: new Date().toISOString(),
        };

        return {
          message: 'Попереднє призначення скинуто після пересадки',
          assignment,
        };
      }

      return originalAssign(payload);
    };

    patchedWindow.__moloWaiterTransferResetPatched = true;
  }
}

export default function WaiterTransferResetController() {
  useEffect(() => {
    function updateTransferSuccess() {
      document.querySelectorAll<HTMLElement>('p').forEach((paragraph) => {
        if (
          paragraph.textContent?.trim() ===
          'Новий стіл закріплено за вами. Попередній стіл переведено в підготовку, якщо гості вже сиділи за ним.'
        ) {
          paragraph.textContent =
            'Після пересадки новий офіціант має повторно натиснути «Гість прийшов». Попереднє призначення скинуто.';
        }
      });
    }

    function openAllBookingsAfterTransfer(event: MouseEvent) {
      const button = (event.target as Element | null)?.closest('button');
      if (!button || button.textContent?.trim() !== 'Готово') return;

      const successPanel = button.closest('div');
      if (!successPanel?.textContent?.includes('Гостей пересаджено')) return;

      window.setTimeout(() => {
        const allBookingsButton = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
          .find((candidate) => candidate.textContent?.includes('Усі бронювання'));
        allBookingsButton?.click();
      }, 0);
    }

    updateTransferSuccess();
    const observer = new MutationObserver(updateTransferSuccess);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('click', openAllBookingsAfterTransfer, true);

    return () => {
      observer.disconnect();
      document.removeEventListener('click', openAllBookingsAfterTransfer, true);
    };
  }, []);

  return null;
}
