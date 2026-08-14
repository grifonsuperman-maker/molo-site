import { bookingsApi } from './bookings';
import { api } from './client';
import type { Booking } from './types';

export type WaiterCallStatus = 'new' | 'accepted' | 'closed';

export type WaiterCall = {
  id: string;
  bookingId: string;
  tableId: string | null;
  tableNumber: string | null;
  clientName: string | null;
  waiterId: string | null;
  waiterName: string | null;
  status: WaiterCallStatus;
  createdAt: string;
  acceptedAt: string | null;
  closedAt: string | null;
};

export type WaiterAssignment = {
  bookingId: string;
  tableId: string | null;
  tableNumber: string | null;
  waiterId: string;
  waiterName: string;
  assignedAt: string;
};

export type GuestWaiterCallStatus = {
  bookingId: string;
  tableNumber: string | null;
  bookingStatus: string;
  tableStatus: string | null;
  canCall: boolean;
  waiterAssigned: boolean;
  waiterName: string | null;
  activeCall: WaiterCall | null;
};

type TransferTable = {
  id: string;
  tableNumber: string;
};

type StoredGuestBooking = {
  bookingId?: unknown;
  token?: unknown;
};

type PatchableBookingsApi = typeof bookingsApi & {
  __waiterAssignmentsPatched?: boolean;
};

const GUEST_BOOKINGS_STORAGE_KEY = 'molo:guest:bookings:v1';
const patchableBookingsApi = bookingsApi as PatchableBookingsApi;

function guestBookingToken(bookingId: string): string {
  if (typeof window === 'undefined') return '';

  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(GUEST_BOOKINGS_STORAGE_KEY) || '[]',
    );
    if (!Array.isArray(parsed)) return '';

    const booking = parsed.find(
      (item: StoredGuestBooking) => item?.bookingId === bookingId,
    );
    return typeof booking?.token === 'string' ? booking.token : '';
  } catch {
    return '';
  }
}

function guestHeaders(bookingId: string): HeadersInit {
  return { 'x-guest-booking-token': guestBookingToken(bookingId) };
}

if (!patchableBookingsApi.__waiterAssignmentsPatched) {
  const originalGetToday = bookingsApi.getToday.bind(bookingsApi);
  const originalWaiterTransfer = bookingsApi.waiterTransfer.bind(bookingsApi);

  bookingsApi.getToday = async () => {
    const bookings = await originalGetToday();

    if (
      typeof window !== 'undefined' &&
      window.location.hash.replace('#', '') !== 'waiter'
    ) {
      return bookings;
    }

    try {
      const assignments = await api.get<WaiterAssignment[]>('/waiter-calls/assignments');
      const assignmentByBookingId = new Map(
        assignments.map((assignment) => [assignment.bookingId, assignment]),
      );

      return bookings.map((booking: Booking) => {
        if (booking.assignedWaiterId) return booking;

        const assignment = assignmentByBookingId.get(booking.id);
        if (!assignment) return booking;

        return {
          ...booking,
          assignedWaiterId: assignment.waiterId,
          assignedWaiterName: assignment.waiterName,
        };
      });
    } catch {
      return bookings;
    }
  };

  bookingsApi.waiterTransfer = async (bookingId: string, tableId: string) => {
    const [bookings, tables] = await Promise.all([
      originalGetToday(),
      api.get<TransferTable[]>('/tables'),
    ]);
    const booking = bookings.find((item) => item.id === bookingId) || null;
    const oldTableId = booking?.table?.id || null;
    const guestsWereSeated = Boolean(booking?.checkedInAt);
    const destination = tables.find((table) => table.id === tableId) || null;

    const result = await originalWaiterTransfer(bookingId, tableId);

    if (guestsWereSeated) {
      await bookingsApi.checkIn(bookingId);
      if (oldTableId) {
        await api.patch<unknown>(`/tables/${encodeURIComponent(oldTableId)}/cleaning`);
      }
    }

    await api.post<{ message: string; assignment: WaiterAssignment }>('/waiter-calls/assign', {
      bookingId,
      tableId,
      tableNumber: destination?.tableNumber || null,
    });

    return result;
  };

  patchableBookingsApi.__waiterAssignmentsPatched = true;
}

export const waiterCallsApi = {
  guestStatus: (bookingId: string) =>
    api.get<GuestWaiterCallStatus>(
      `/waiter-calls/guest-status/${encodeURIComponent(bookingId)}`,
      { headers: guestHeaders(bookingId) },
    ),

  createFromGuest: (bookingId: string) =>
    api.post<{ message: string; call: WaiterCall }>(
      '/waiter-calls',
      { bookingId },
      { headers: guestHeaders(bookingId) },
    ),

  list: () => api.get<WaiterCall[]>('/waiter-calls'),

  assignments: () => api.get<WaiterAssignment[]>('/waiter-calls/assignments'),

  assign: (payload: {
    bookingId: string;
    tableId?: string | null;
    tableNumber?: string | null;
  }) => api.post<{ message: string; assignment: WaiterAssignment }>('/waiter-calls/assign', payload),

  accept: (id: string) => api.patch<{ message: string; call: WaiterCall }>(`/waiter-calls/${encodeURIComponent(id)}/accept`),

  close: (id: string) =>
    api.patch<{ message: string; call: WaiterCall }>(`/waiter-calls/${encodeURIComponent(id)}/close`),
};