import { api } from './client';
import type { Booking } from './types';

export type AdminAttentionKind =
  | 'booking_created'
  | 'guest_cancelled'
  | 'guest_reported_lateness'
  | 'reschedule'
  | 'table_change'
  | 'review'
  | 'admin_call';

export type AdminAttentionItem = {
  id: string;
  requestId?: string;
  kind: AdminAttentionKind;
  priority: number;
  createdAt: string;
  status?: 'new' | 'accepted';
  reason?: string | null;
  text?: string;
  requestedDate?: string;
  requestedTime?: string;
  requestedTableId?: string | null;
  requestedTableNumber?: string | null;
  requestedZoneName?: string | null;
  previousTableNumber?: string | null;
  booking: Booking;
};

export type AdminGuestReview = {
  id: string;
  text: string;
  isPublished: boolean;
  createdAt: string;
  booking: Booking;
};

type ActionResponse = { message: string };

export const adminAttentionApi = {
  list: () => api.get<AdminAttentionItem[]>('/bookings/admin-attention'),
  listReviews: () => api.get<AdminGuestReview[]>('/bookings/admin-reviews'),
  acknowledge: (requestId: string) =>
    api.patch<ActionResponse>(`/bookings/admin-attention/${encodeURIComponent(requestId)}/acknowledge`),
  approveReschedule: (requestId: string) =>
    api.patch<ActionResponse>(`/bookings/admin-attention/reschedule/${encodeURIComponent(requestId)}/approve`),
  rejectReschedule: (requestId: string, comment?: string) =>
    api.patch<ActionResponse>(`/bookings/admin-attention/reschedule/${encodeURIComponent(requestId)}/reject`, { comment }),
  approveTableChange: (requestId: string, tableId: string) =>
    api.patch<ActionResponse>(`/bookings/admin-attention/table-change/${encodeURIComponent(requestId)}/approve`, { tableId }),
  rejectTableChange: (requestId: string, comment?: string) =>
    api.patch<ActionResponse>(`/bookings/admin-attention/table-change/${encodeURIComponent(requestId)}/reject`, { comment }),
  acceptAdminCall: (requestId: string) =>
    api.patch<ActionResponse>(`/bookings/admin-attention/call/${encodeURIComponent(requestId)}/accept`),
  completeAdminCall: (requestId: string) =>
    api.patch<ActionResponse>(`/bookings/admin-attention/call/${encodeURIComponent(requestId)}/complete`),
  acknowledgeReview: (reviewId: string) =>
    api.patch<ActionResponse>(`/bookings/admin-attention/review/${encodeURIComponent(reviewId)}/acknowledge`),
};
