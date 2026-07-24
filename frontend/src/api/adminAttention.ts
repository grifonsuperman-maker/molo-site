import { api } from './client';
import type { Booking } from './types';

export type AdminAttentionKind =
  | 'booking_event'
  | 'reschedule_request'
  | 'table_change_request'
  | 'admin_call'
  | 'review';

export type AdminAttentionBooking = Booking & {
  latenessHours?: number | null;
  latenessMinutes?: number | null;
  expectedArrivalAt?: string | null;
};

export type AdminAttentionItem = {
  id: string;
  sourceId: string;
  kind: AdminAttentionKind;
  createdAt: string;
  booking: AdminAttentionBooking;
  action?: string;
  reason?: string | null;
  previousData?: Record<string, unknown> | null;
  newData?: Record<string, unknown> | null;
  requestedDate?: string;
  requestedTime?: string;
  requestedTableNumber?: string | null;
  status?: 'new' | 'accepted';
  acceptedAt?: string | null;
  text?: string;
  isPublished?: boolean;
};

export type AdminAttentionInbox = {
  items: AdminAttentionItem[];
  reviews: AdminAttentionItem[];
};

export type AdminTableOption = {
  id: string;
  tableNumber: string;
  seats: number;
  zoneName: string;
};

export type GuestAdminCall = {
  id: string;
  status: 'new' | 'accepted' | 'completed';
  createdAt: string;
  acceptedAt?: string | null;
  completedAt?: string | null;
};

export type GuestAdminCallStatus = {
  bookingId: string;
  tableNumber: string | null;
  canCall: boolean;
  activeCall: GuestAdminCall | null;
};

type ActionResponse = { message: string };

function encode(value: string) {
  return encodeURIComponent(value);
}

export const adminAttentionApi = {
  inbox: (limit = 150) =>
    api.get<AdminAttentionInbox>(`/admin-attention?limit=${Math.max(1, Math.floor(limit))}`),

  tableOptions: (requestId: string) =>
    api.get<AdminTableOption[]>(`/admin-attention/table-change/${encode(requestId)}/options`),

  approveTableChange: (requestId: string, tableId: string) =>
    api.patch<ActionResponse>(`/admin-attention/table-change/${encode(requestId)}/approve`, { tableId }),

  rejectTableChange: (requestId: string, adminComment?: string) =>
    api.patch<ActionResponse>(`/admin-attention/table-change/${encode(requestId)}/reject`, { adminComment }),

  approveReschedule: (requestId: string) =>
    api.patch<ActionResponse>(`/admin-attention/reschedule/${encode(requestId)}/approve`),

  rejectReschedule: (requestId: string, adminComment?: string) =>
    api.patch<ActionResponse>(`/admin-attention/reschedule/${encode(requestId)}/reject`, { adminComment }),

  acceptAdminCall: (callId: string) =>
    api.patch<ActionResponse>(`/admin-attention/admin-call/${encode(callId)}/accept`),

  completeAdminCall: (callId: string) =>
    api.patch<ActionResponse>(`/admin-attention/admin-call/${encode(callId)}/complete`),

  requestTableChange: (
    bookingId: string,
    token: string,
    payload: { tableNumber?: string | null },
  ) => api.patch<ActionResponse>(
    `/guest-attention/${encode(bookingId)}/table-change`,
    payload,
    { headers: { 'x-guest-booking-token': token } },
  ),

  guestAdminCallStatus: (bookingId: string) =>
    api.get<GuestAdminCallStatus>(`/guest-attention/${encode(bookingId)}/admin-call`),

  createGuestAdminCall: (bookingId: string) =>
    api.post<{ message: string; call: GuestAdminCall }>(
      `/guest-attention/${encode(bookingId)}/admin-call`,
    ),
};
