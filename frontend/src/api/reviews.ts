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

type ReviewMutationResult = {
  ok: boolean;
  id: string;
};

export const reviewsApi = {
  getAll: () => api.get<GuestReviewRecord[]>('/guest-reviews'),
  getArchive: () => api.get<GuestReviewRecord[]>('/guest-reviews/archive'),
  respond: (id: string, text: string) =>
    api.patch<GuestReviewRecord>(
      `/guest-reviews/${encodeURIComponent(id)}/response`,
      { text },
    ),
  archive: (id: string) =>
    api.patch<ReviewMutationResult>(
      `/guest-reviews/${encodeURIComponent(id)}/archive`,
    ),
  restore: (id: string) =>
    api.patch<ReviewMutationResult>(
      `/guest-reviews/${encodeURIComponent(id)}/restore`,
    ),
  deletePermanently: (id: string) =>
    api.delete<ReviewMutationResult>(`/guest-reviews/${encodeURIComponent(id)}`),
};
