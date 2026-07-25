import { api } from './client';

export type GuestReviewRecord = {
  id: string;
  text: string;
  isPublished: boolean;
  responseText?: string | null;
  respondedAt?: string | null;
  respondedByName?: string | null;
  respondedByRole?: string | null;
  createdAt: string;
  booking?: {
    id: string;
    bookingDate: string;
    bookingTime: string;
    client?: {
      id?: string;
      fullName?: string | null;
      phone?: string | null;
    } | null;
    table?: {
      id?: string;
      tableNumber?: string | null;
      zone?: { id?: string; name?: string | null } | null;
    } | null;
  } | null;
};

export const reviewsApi = {
  getAll: () => api.get<GuestReviewRecord[]>('/guest-reviews'),
  respond: (id: string, text: string) =>
    api.patch<GuestReviewRecord>(
      `/guest-reviews/${encodeURIComponent(id)}/response`,
      { text },
    ),
};
