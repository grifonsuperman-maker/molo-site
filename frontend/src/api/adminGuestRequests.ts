import { api } from './client';

export type AdminGuestRequestBooking = {
  id: string;
  status: string;
  bookingDate: string;
  bookingTime: string;
  durationMinutes?: number | null;
  guestsCount: number;
  table?: {
    id: string;
    tableNumber: string;
    seats?: number;
    zone?: { id: string; name: string } | null;
  } | null;
  client?: {
    id: string;
    fullName: string;
    phone: string;
  } | null;
};

export type AdminRescheduleRequest = {
  id: string;
  requestedDate: string;
  requestedTime: string;
  status: string;
  adminComment?: string | null;
  createdAt: string;
  booking: AdminGuestRequestBooking;
};

export type AdminTableChangeRequest = {
  id: string;
  requestedTableNumber?: string | null;
  status: string;
  adminComment?: string | null;
  createdAt: string;
  booking: AdminGuestRequestBooking;
};

export type AdminGuestReview = {
  id: string;
  text: string;
  acknowledgedAt?: string | null;
  createdAt: string;
  booking: AdminGuestRequestBooking;
};

export type AdminGuestRequestsResponse = {
  reschedules: AdminRescheduleRequest[];
  tableChanges: AdminTableChangeRequest[];
  reviews: AdminGuestReview[];
};

const base = '/bookings/admin-guest-requests';

export const adminGuestRequestsApi = {
  list: () => api.get<AdminGuestRequestsResponse>(base),
  acknowledgeReview: (id: string) =>
    api.patch<{ message: string }>(`${base}/reviews/${encodeURIComponent(id)}/ack`),
  approveReschedule: (id: string) =>
    api.patch<{ message: string }>(`${base}/reschedules/${encodeURIComponent(id)}/approve`),
  rejectReschedule: (id: string, adminComment?: string) =>
    api.patch<{ message: string }>(`${base}/reschedules/${encodeURIComponent(id)}/reject`, { adminComment }),
  approveTableChange: (id: string, tableId: string) =>
    api.patch<{ message: string }>(`${base}/table-changes/${encodeURIComponent(id)}/approve`, { tableId }),
  rejectTableChange: (id: string, adminComment?: string) =>
    api.patch<{ message: string }>(`${base}/table-changes/${encodeURIComponent(id)}/reject`, { adminComment }),
};
