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

export type GuestReviewArchivePage = {
  items: GuestReviewRecord[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
};

type ReviewMutationResult = {
  ok: boolean;
  id: string;
};

export const reviewsApi = {
  getAll: () => api.get<GuestReviewRecord[]>('/guest-reviews'),
  getArchive: ({ page = 1, limit = 50, query = '' }: { page?: number; limit?: number; query?: string } = {}) => {
    const params = new URLSearchParams({
      page: String(page),
      limit: String(limit),
    });
    if (query.trim()) params.set('q', query.trim());
    return api.get<GuestReviewArchivePage>(`/guest-reviews/archive?${params.toString()}`);
  },
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
