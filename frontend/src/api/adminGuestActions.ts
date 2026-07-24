import { api } from './client';
import type { Booking, TableItem } from './types';

export type AdminRescheduleRequest = {
  id: string;
  requestedDate: string;
  requestedTime: string;
  status: 'pending' | 'approved' | 'rejected';
  adminComment?: string | null;
  createdAt: string;
  booking: Booking;
};

export type AdminTableChangeRequest = {
  id: string;
  requestedTableNumber?: string | null;
  status: 'pending' | 'approved' | 'rejected';
  adminComment?: string | null;
  createdAt: string;
  booking: Booking;
  selectedTable?: TableItem | null;
};

export type AdminGuestReview = {
  id: string;
  text: string;
  isPublished: boolean;
  createdAt: string;
  booking: Booking;
};

type ActionResponse = { message: string };

function encode(value: string) {
  return encodeURIComponent(value);
}

export const adminGuestActionsApi = {
  pendingReschedules: () =>
    api.get<AdminRescheduleRequest[]>('/bookings/reschedule/pending'),

  approveReschedule: (requestId: string) =>
    api.patch<ActionResponse>(
      `/bookings/admin-actions/reschedules/${encode(requestId)}/approve`,
    ),

  rejectReschedule: (requestId: string, adminComment?: string) =>
    api.patch<ActionResponse>(
      `/bookings/admin-actions/reschedules/${encode(requestId)}/reject`,
      { adminComment },
    ),

  pendingTableChanges: () =>
    api.get<AdminTableChangeRequest[]>(
      '/bookings/admin-actions/table-changes/pending',
    ),

  approveTableChange: (requestId: string, tableId: string) =>
    api.patch<ActionResponse>(
      `/bookings/admin-actions/table-changes/${encode(requestId)}/approve`,
      { tableId },
    ),

  rejectTableChange: (requestId: string, adminComment?: string) =>
    api.patch<ActionResponse>(
      `/bookings/admin-actions/table-changes/${encode(requestId)}/reject`,
      { adminComment },
    ),

  reviews: (limit = 150) =>
    api.get<AdminGuestReview[]>(
      `/bookings/admin-actions/reviews?limit=${encode(String(limit))}`,
    ),
};
