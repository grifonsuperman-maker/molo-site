import { api } from './client';

export type WaiterCallStatus = 'new' | 'accepted' | 'closed';

export type WaiterCall = {
  id: string;
  bookingId: string;
  tableId: string | null;
  tableNumber: string | null;
  clientName: string | null;
  clientPhone: string | null;
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

const guestStatusCache = new Map<string, GuestWaiterCallStatus>();

async function getGuestStatus(bookingId: string) {
  try {
    const status = await api.get<GuestWaiterCallStatus>(
      `/waiter-calls/guest-status/${encodeURIComponent(bookingId)}`,
    );
    guestStatusCache.set(bookingId, status);
    return status;
  } catch (error) {
    const cached = guestStatusCache.get(bookingId);
    if (cached) return cached;
    throw error;
  }
}

export const waiterCallsApi = {
  guestStatus: getGuestStatus,

  createFromGuest: async (bookingId: string) => {
    const result = await api.post<{ message: string; call: WaiterCall }>('/waiter-calls', { bookingId });
    const cached = guestStatusCache.get(bookingId);
    if (cached) {
      guestStatusCache.set(bookingId, { ...cached, activeCall: result.call });
    }
    return result;
  },

  list: (waiterId: string) =>
    api.get<WaiterCall[]>(`/waiter-calls?waiterId=${encodeURIComponent(waiterId)}`),

  assignments: (waiterId: string) =>
    api.get<WaiterAssignment[]>(`/waiter-calls/assignments?waiterId=${encodeURIComponent(waiterId)}`),

  assign: (payload: {
    bookingId: string;
    tableId?: string | null;
    tableNumber?: string | null;
    waiterId: string;
    waiterName: string;
  }) => api.post<{ message: string; assignment: WaiterAssignment }>('/waiter-calls/assign', payload),

  accept: (id: string, payload: { waiterId: string; waiterName: string }) =>
    api.patch<{ message: string; call: WaiterCall }>(`/waiter-calls/${encodeURIComponent(id)}/accept`, payload),

  close: (id: string) =>
    api.patch<{ message: string; call: WaiterCall }>(`/waiter-calls/${encodeURIComponent(id)}/close`),
};
