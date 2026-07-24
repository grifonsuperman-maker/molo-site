import { api } from './client';
import type { Booking, TableItem, Zone } from './types';

export type AvailabilityBlock = {
  id: string;
  blockDate: string;
  startTime: string | null;
  endTime: string | null;
  reason: string;
  table: (Pick<TableItem, 'id' | 'tableNumber'> & { zone?: Zone | null }) | null;
  zone: Pick<Zone, 'id' | 'name'> | null;
  createdAt: string;
};

export type CreateAvailabilityBlockPayload = {
  tableId?: string;
  zoneId?: string;
  blockDate: string;
  startTime?: string;
  endTime?: string;
  reason: string;
};

export const availabilityBlocksApi = {
  list: (date: string) =>
    api.get<AvailabilityBlock[]>(`/availability-blocks?date=${encodeURIComponent(date)}`),

  create: (payload: CreateAvailabilityBlockPayload) =>
    api.post<AvailabilityBlock>('/availability-blocks', payload),

  remove: (id: string) =>
    api.delete<{ message: string }>(`/availability-blocks/${encodeURIComponent(id)}`),

  transferBooking: (bookingId: string, tableId: string, reason?: string) =>
    api.patch<{ message: string; booking: Booking }>(
      `/availability-blocks/bookings/${encodeURIComponent(bookingId)}/transfer`,
      { tableId, reason },
    ),
};
