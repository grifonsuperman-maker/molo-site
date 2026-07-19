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
  status:
    | 'free'
    | 'pending'
    | 'reserved'
    | 'occupied'
    | 'cleaning'
    | 'closed';
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

type ActionResponse = {
  message: string;
};

function encode(value: string): string {
  return encodeURIComponent(value);
}

function buildAvailabilityQuery(params: {
  tableId: string;
  bookingDate: string;
  bookingTime: string;
  durationMinutes?: number;
}): string {
  const search = new URLSearchParams({
    tableId: params.tableId,
    bookingDate: params.bookingDate,
    bookingTime: params.bookingTime,
    durationMinutes: String(params.durationMinutes ?? 120),
  });

  return search.toString();
}

function buildTableStatusesQuery(params: {
  bookingDate: string;
  bookingTime: string;
  durationMinutes?: number;
}): string {
  const search = new URLSearchParams({
    bookingDate: params.bookingDate,
    bookingTime: params.bookingTime,
    durationMinutes: String(params.durationMinutes ?? 120),
  });

  return search.toString();
}

export const bookingsApi = {
  create: (payload: CreateBookingPayload) =>
    api.post<{
      message: string;
      bookingId: string;
      status: string;
      bookingTime: string;
      departureTime: string | null;
      availableFrom: string | null;
      durationMinutes: number;
      cleanupMinutes: number;
    }>('/bookings', payload),

  availability: (params: {
    tableId: string;
    bookingDate: string;
    bookingTime: string;
    durationMinutes?: number;
  }) =>
    api.get<BookingAvailability>(
      `/bookings/availability?${buildAvailabilityQuery(params)}`,
    ),

  tableStatuses: (params: {
    bookingDate: string;
    bookingTime: string;
    durationMinutes?: number;
  }) =>
    api.get<TableStatusesResponse>(
      `/bookings/table-statuses?${buildTableStatusesQuery(params)}`,
    ),

  getPublicStatus: (id: string) =>
    api.get<BookingPublicStatus>(`/bookings/${encode(id)}/status`),

  getPendingReminders: () =>
    api.get<Booking[]>('/bookings/pending-reminders'),

  getToday: () => api.get<Booking[]>('/bookings/today'),

  getByDate: (date: string) =>
    api.get<Booking[]>(`/bookings/by-date?date=${encode(date)}`),

  getArchive: (params?: {
    date?: string;
    limit?: number;
  }) => {
    const search = new URLSearchParams();

    if (params?.date) {
      search.set('date', params.date);
    }

    if (
      typeof params?.limit === 'number' &&
      Number.isFinite(params.limit) &&
      params.limit > 0
    ) {
      search.set('limit', String(Math.floor(params.limit)));
    }

    const query = search.toString();

    return api.get<Booking[]>(
      `/bookings/archive${query ? `?${query}` : ''}`,
    );
  },

  getStats: () => api.get<BookingStats>('/bookings/stats'),

  approve: (id: string) =>
    api.patch<ActionResponse>(`/bookings/${encode(id)}/approve`),

  reject: (id: string) =>
    api.patch<ActionResponse>(`/bookings/${encode(id)}/reject`),

  cancel: (id: string) =>
    api.patch<ActionResponse>(`/bookings/${encode(id)}/cancel`),

  noShow: (id: string) =>
    api.patch<ActionResponse>(`/bookings/${encode(id)}/no-show`),

  checkIn: (id: string) =>
    api.patch<ActionResponse>(`/bookings/${encode(id)}/check-in`),

  complete: (id: string) =>
    api.patch<ActionResponse>(`/bookings/${encode(id)}/complete`),
};
