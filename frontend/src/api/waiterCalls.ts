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

export const waiterCallsApi = {
  guestStatus: (bookingId: string) =>
    api.get<GuestWaiterCallStatus>(`/waiter-calls/guest-status/${encodeURIComponent(bookingId)}`),

  createFromGuest: (bookingId: string) =>
    api.post<{ message: string; call: WaiterCall }>('/waiter-calls', { bookingId }),

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
