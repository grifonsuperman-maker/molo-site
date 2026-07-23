import { api } from './client';
import type { Booking } from './types';

export type AdminBookingEventAction =
  | 'booking_created'
  | 'guest_cancelled'
  | 'guest_reported_lateness'
  | 'guest_changed_table';

export type AdminBookingEvent = {
  id: string;
  action: AdminBookingEventAction;
  createdAt: string;
  reason: string | null;
  previousData: Record<string, unknown> | null;
  newData: Record<string, unknown> | null;
  booking: Booking & {
    cancellationReason?: string | null;
    latenessHours?: number | null;
    latenessMinutes?: number | null;
    expectedArrivalAt?: string | null;
    updatedAt?: string;
  };
};

export const adminBookingEventsApi = {
  getRecent: (limit = 120) =>
    api.get<AdminBookingEvent[]>(`/bookings/admin-events?limit=${Math.max(1, Math.floor(limit))}`),
};
