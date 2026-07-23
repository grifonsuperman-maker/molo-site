import { api } from './client';

export type GuestReviewRecord = {
  id: string;
  text: string;
  isPublished: boolean;
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
};
