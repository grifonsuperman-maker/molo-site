import { api } from './client';
import type { AdminBookingEvent } from './adminBookingEvents';
import type { Booking, TableItem } from './types';

export type AdminRescheduleRequest = {
  id: string;
  requestedDate: string;
  requestedTime: string;
  status: 'pending' | 'approved' | 'rejected';
  adminComment: string | null;
  createdAt: string;
  resolvedAt: string | null;
  booking: Booking;
};

export type AdminTableChangeRequest = {
  id: string;
  requestedTableNumber: string | null;
  selectedTable: TableItem | null;
  status: 'pending' | 'approved' | 'rejected';
  adminComment: string | null;
  createdAt: string;
  resolvedAt: string | null;
  booking: Booking;
};

export type AdminGuestReview = {
  id: string;
  text: string;
  isPublished: boolean;
  publishedAt: string | null;
  externalReviewOpenedAt: string | null;
  createdAt: string;
  updatedAt: string;
  booking: Booking;
};

export type AdminGuestCall = {
  id: string;
  status: 'new' | 'accepted' | 'completed';
  createdAt: string;
  acceptedAt: string | null;
  completedAt: string | null;
  booking: Booking;
};

export type AdminAttentionFeed = {
  bookingEvents: AdminBookingEvent[];
  reschedules: AdminRescheduleRequest[];
  tableChanges: AdminTableChangeRequest[];
  reviews: AdminGuestReview[];
  adminCalls: AdminGuestCall[];
};

export type GuestAdminCallPayload = {
  id: string;
  status: 'new' | 'accepted' | 'completed';
  createdAt: string;
  acceptedAt: string | null;
  completedAt: string | null;
  bookingId: string;
  tableNumber: string | null;
  clientName: string | null;
};

export type GuestAdminCallStatus = {
  bookingId: string;
  tableNumber: string | null;
  bookingStatus: Booking['status'];
  canCall: boolean;
  activeCall: GuestAdminCallPayload | null;
};

function encode(value: string) {
  return encodeURIComponent(value);
}

export const adminAttentionApi = {
  getFeed: (limit = 150) =>
    api.get<AdminAttentionFeed>(
      `/bookings/admin-attention?limit=${Math.max(1, Math.floor(limit))}`,
    ),

  approveReschedule: (requestId: string) =>
    api.patch<{ message: string }>(
      `/bookings/admin-attention/reschedules/${encode(requestId)}/approve`,
    ),

  rejectReschedule: (requestId: string, adminComment?: string) =>
    api.patch<{ message: string }>(
      `/bookings/admin-attention/reschedules/${encode(requestId)}/reject`,
      { adminComment },
    ),

  approveTableChange: (requestId: string, tableId: string) =>
    api.patch<{ message: string }>(
      `/bookings/admin-attention/table-changes/${encode(requestId)}/approve`,
      { tableId },
    ),

  rejectTableChange: (requestId: string, adminComment?: string) =>
    api.patch<{ message: string }>(
      `/bookings/admin-attention/table-changes/${encode(requestId)}/reject`,
      { adminComment },
    ),

  acceptAdminCall: (callId: string) =>
    api.patch<{ message: string; call: GuestAdminCallPayload }>(
      `/bookings/admin-attention/admin-calls/${encode(callId)}/accept`,
    ),

  completeAdminCall: (callId: string) =>
    api.patch<{ message: string; call: GuestAdminCallPayload }>(
      `/bookings/admin-attention/admin-calls/${encode(callId)}/complete`,
    ),

  guestAdminCallStatus: (bookingId: string) =>
    api.get<GuestAdminCallStatus>(
      `/bookings/${encode(bookingId)}/guest/admin-call`,
    ),

  createGuestAdminCall: (bookingId: string) =>
    api.post<{ message: string; call: GuestAdminCallPayload }>(
      `/bookings/${encode(bookingId)}/guest/admin-call`,
    ),
};
