import { api } from './client';
import type { Booking } from './types';

export type AdminManualBookingPayload = {
  tableId: string;
  fullName: string;
  phone: string;
  bookingDate: string;
  bookingTime: string;
  guestsCount: number;
  durationMinutes: number;
  wishes?: string;
};

export type AdminBookingCalendarDay = {
  date: string;
  total: number;
  pending: number;
  approved: number;
  guests: number;
};

export type AdminBookingCalendar = {
  today: string;
  endDate: string;
  days: number;
  total: number;
  pending: number;
  approved: number;
  dates: AdminBookingCalendarDay[];
};

export const adminBookingsApi = {
  createManual: (payload: AdminManualBookingPayload) =>
    api.post<Booking>('/admin/bookings/manual', payload),

  changeTable: (bookingId: string, tableId: string) =>
    api.patch<{ message: string; booking: Booking }>(
      `/admin/bookings/${encodeURIComponent(bookingId)}/change-table`,
      { tableId },
    ),

  upcoming: (days = 180) =>
    api.get<AdminBookingCalendar>(
      `/admin/bookings/upcoming?days=${encodeURIComponent(String(days))}`,
    ),
};
