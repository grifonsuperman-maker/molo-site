import { api } from './client';
import type { Booking, TableItem } from './types';

export type AdminTableChangeRequest = {
  id: string;
  requestedTableNumber: string | null;
  status: 'pending' | 'approved' | 'rejected';
  adminComment: string | null;
  createdAt: string;
  resolvedAt: string | null;
  approvedTable: TableItem | null;
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

export type AdminAttentionDashboard = {
  tableChanges: AdminTableChangeRequest[];
  reviews: AdminGuestReview[];
};

type ActionResponse = { message: string; tableNumber?: string };

function encode(value: string) {
  return encodeURIComponent(value);
}

export const adminAttentionApi = {
  get: () => api.get<AdminAttentionDashboard>('/admin-attention'),
  approveTableChange: (requestId: string, tableId: string) =>
    api.patch<ActionResponse>(`/admin-attention/table-change/${encode(requestId)}/approve`, { tableId }),
  rejectTableChange: (requestId: string, adminComment?: string) =>
    api.patch<ActionResponse>(`/admin-attention/table-change/${encode(requestId)}/reject`, { adminComment }),
};
