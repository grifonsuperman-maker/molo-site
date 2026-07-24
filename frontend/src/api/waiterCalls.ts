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

type PatchableBookingsApi = typeof bookingsApi & {
  __waiterAssignmentsPatched?: boolean;
};

const patchableBookingsApi = bookingsApi as PatchableBookingsApi;

if (!patchableBookingsApi.__waiterAssignmentsPatched) {
  const originalGetToday = bookingsApi.getToday.bind(bookingsApi);

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

  patchableBookingsApi.__waiterAssignmentsPatched = true;
}

export const waiterCallsApi = {
  guestStatus: (bookingId: string) =>
    api.get<GuestWaiterCallStatus>(`/waiter-calls/guest-status/${encodeURIComponent(bookingId)}`),

  createFromGuest: (bookingId: string) =>
    api.post<{ message: string; call: WaiterCall }>('/waiter-calls', { bookingId }),

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
