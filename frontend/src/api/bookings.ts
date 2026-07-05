import { api } from './client';
import type { Booking } from './types';

export type CreateBookingPayload = {
  tableId?: string;
  tableNumber?: string;
  seats?: number;
  fullName: string;
  phone: string;
  bookingDate: string;
  bookingTime: string;
  guestsCount: number;
  durationMinutes?: number;
  wishes?: string;
};

export type BookingAvailability = {
  tableId: string;
  tableNumber: string;
  bookingDate: string;
  requestedFrom: string;
  requestedTo: string;
  requestedAvailableFrom: string;
  requestedFromLabel: string;
  requestedToLabel: string;
  requestedAvailableFromLabel: string;
  durationMinutes: number;
  cleanupMinutes: number;
  isAvailable: boolean;
  reason: string | null;
  nextAvailableFrom?: string | null;
  nextAvailableFromLabel?: string | null;
  conflict: null | {
    bookingId: string;
    status: string;
    tableNumber: string | null;
    bookedFrom: string;
    bookedTo: string;
    availableFrom: string;
    bookedFromLabel: string;
    bookedToLabel: string;
    availableFromLabel: string;
  };
};

export const bookingsApi = {
  create: (b: CreateBookingPayload) =>
    api.post<{
      message: string;
      bookingId: string;
      status: string;
      bookingTime: string;
      departureTime: string | null;
      availableFrom: string | null;
      durationMinutes: number;
      cleanupMinutes: number;
    }>('/bookings', b),

  availability: (params: {
    tableId: string;
    bookingDate: string;
    bookingTime: string;
    durationMinutes?: number;
  }) =>
    api.get<BookingAvailability>(
      `/bookings/availability?tableId=${encodeURIComponent(params.tableId)}&bookingDate=${encodeURIComponent(params.bookingDate)}&bookingTime=${encodeURIComponent(params.bookingTime)}&durationMinutes=${encodeURIComponent(String(params.durationMinutes || 120))}`,
    ),

  getToday: () => api.get<Booking[]>('/bookings/today'),
  approve: (id: string) => api.patch<{ message: string }>(`/bookings/${id}/approve`),
  reject: (id: string) => api.patch<{ message: string }>(`/bookings/${id}/reject`),
  cancel: (id: string) => api.patch<{ message: string }>(`/bookings/${id}/cancel`),
  checkIn: (id: string) => api.patch<{ message: string }>(`/bookings/${id}/check-in`),
  complete: (id: string) => api.patch<{ message: string }>(`/bookings/${id}/complete`),
};
