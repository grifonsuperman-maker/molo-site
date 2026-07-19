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

export type TableRuntimeStatus = {
  tableId: string;
  tableNumber: string;
  status: 'free' | 'pending' | 'reserved' | 'occupied' | 'cleaning' | 'closed';
  reason: string | null;
  conflict: BookingAvailability['conflict'];
};

export type TableStatusesResponse = {
  bookingDate: string;
  bookingTime: string;
  durationMinutes: number;
  cleanupMinutes: number;
  requestedFrom: string;
  requestedTo: string;
  requestedAvailableFrom: string;
  requestedFromLabel: string;
  requestedToLabel: string;
  requestedAvailableFromLabel: string;
  today: string;
  statuses: Record<string, TableRuntimeStatus>;
};

export type BookingPublicStatus = {
  bookingId: string;
  status: Booking['status'];
  tableNumber: string | null;
  bookingDate: string;
  bookingTime: string;
  bookedFrom: string;
  bookedTo: string;
  availableFrom: string;
  bookedFromLabel: string;
  bookedToLabel: string;
  availableFromLabel: string;
  guestsCount: number;
  createdAt: string;
  approvedAt?: string | null;
  rejectedAt?: string | null;
  cancelledAt?: string | null;
  completedAt?: string | null;
  pendingAgeMinutes: number;
  pendingReminderMinutes: number;
  isPendingTooLong: boolean;
  restaurantPhone: string | null;
};

export type BookingStats = {
  today: string;
  total: number;
  todayTotal: number;
  pendingToday: number;
  overduePendingToday: number;
  archivedTotal: number;
  occupiedTables: number;
  cleaningTables: number;
  pendingReminderMinutes: number;
};

type ActionResponse = { message: string };

function getKyivDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;

  return year && month && day ? `${year}-${month}-${day}` : '';
}

function normalizePublicStatus(status: BookingPublicStatus): BookingPublicStatus {
  const today = getKyivDate();
  const isPastBooking =
    Boolean(today) &&
    Boolean(status.bookingDate) &&
    status.bookingDate < today;

  if (
    isPastBooking &&
    (status.status === 'pending' || status.status === 'approved')
  ) {
    return {
      ...status,
      status: 'completed',
      completedAt: status.completedAt || new Date().toISOString(),
    };
  }

  return status;
}

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

  tableStatuses: (params: {
    bookingDate: string;
    bookingTime: string;
    durationMinutes?: number;
  }) =>
    api.get<TableStatusesResponse>(
      `/bookings/table-statuses?bookingDate=${encodeURIComponent(params.bookingDate)}&bookingTime=${encodeURIComponent(params.bookingTime)}&durationMinutes=${encodeURIComponent(String(params.durationMinutes || 120))}`,
    ),

  getPublicStatus: async (id: string) => {
    const status = await api.get<BookingPublicStatus>(
      `/bookings/${encodeURIComponent(id)}/status`,
    );

    return normalizePublicStatus(status);
  },

  getPendingReminders: () =>
    api.get<Booking[]>('/bookings/pending-reminders'),

  getToday: () =>
    api.get<Booking[]>('/bookings/today'),

  getByDate: (date: string) =>
    api.get<Booking[]>(`/bookings/by-date?date=${encodeURIComponent(date)}`),

  getArchive: (params?: { date?: string; limit?: number }) => {
    const search = new URLSearchParams();

    if (params?.date) {
      search.set('date', params.date);
    }

    if (params?.limit) {
      search.set('limit', String(params.limit));
    }

    const query = search.toString();
    return api.get<Booking[]>(`/bookings/archive${query ? `?${query}` : ''}`);
  },

  getStats: () =>
    api.get<BookingStats>('/bookings/stats'),

  approve: (id: string) =>
    api.patch<ActionResponse>(`/bookings/${id}/approve`),

  reject: (id: string) =>
    api.patch<ActionResponse>(`/bookings/${id}/reject`),

  cancel: (id: string) =>
    api.patch<ActionResponse>(`/bookings/${id}/cancel`),

  noShow: (id: string) =>
    api.patch<ActionResponse>(`/bookings/${id}/no-show`),

  checkIn: (id: string) =>
    api.patch<ActionResponse>(`/bookings/${id}/check-in`),

  complete: (id: string) =>
    api.patch<ActionResponse>(`/bookings/${id}/complete`),
};
