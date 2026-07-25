import { api } from './client';
import type { Booking } from './types';

export type CreateBookingPayload = {
  tableId?: string;
  tableNumber?: string;
  seats?: number;
  fullName: string;
  phone: string;
  guestDeviceId: string;
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
  lateNotifiedAt?: string | null;
  isLatenessPromptDue?: boolean;
  canGuestCancel?: boolean;
  canGuestChangeTable?: boolean;
  canGuestChangeTime?: boolean;
  canReportLateness?: boolean;
  canLeaveReview?: boolean;
  guestNotification?: GuestBooking['guestNotification'];
};

export type GuestBooking = {
  bookingId: string;
  status: Booking['status'];
  tableId: string | null;
  tableNumber: string | null;
  bookingDate: string;
  bookingTime: string;
  durationMinutes: number;
  guestsCount: number;
  createdAt: string;
  approvedAt?: string | null;
  rejectedAt?: string | null;
  cancelledAt?: string | null;
  completedAt?: string | null;
  restaurantPhone: string | null;
  checkedInAt?: string | null;
  lateNotifiedAt?: string | null;
  latenessHours?: number | null;
  latenessMinutes?: number | null;
  expectedArrivalAt?: string | null;
  isLatenessPromptDue?: boolean;
  canGuestCancel?: boolean;
  canGuestChangeTable?: boolean;
  canGuestChangeTime?: boolean;
  canReportLateness?: boolean;
  canLeaveReview?: boolean;
  guestNotification?: {
    title?: string;
    message?: string;
    acknowledgedAt?: string | null;
  } | null;
};

export type GuestBookingToken = {
  bookingId: string;
  token: string;
  createdAt: string;
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
  booking?: GuestBooking;
  askExternalReview?: boolean;
};

function encode(value: string): string {
  return encodeURIComponent(value);
}

function guestHeaders(token: string): HeadersInit {
  return { 'x-guest-booking-token': token };
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
      guestAccessToken: string;
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

  guestList: (guestDeviceId: string, tokens: string[] = []) =>
    api.post<GuestBooking[]>('/bookings/guest/list', { guestDeviceId, tokens }),

  getGuest: (id: string, token: string) =>
    api.get<GuestBooking>(`/bookings/${encode(id)}/guest`, { headers: guestHeaders(token) }),

  guestCancel: (id: string, token: string, reason?: string) =>
    api.patch<ActionResponse>(`/bookings/${encode(id)}/guest/cancel`, { reason }, { headers: guestHeaders(token) }),

  guestLateness: (id: string, token: string, hours: number, minutes: number) =>
    api.patch<ActionResponse>(`/bookings/${encode(id)}/guest/lateness`, { hours, minutes }, { headers: guestHeaders(token) }),

  guestChangeTime: (
    id: string,
    token: string,
    payload: { requestedDate: string; requestedTime: string },
  ) =>
    api.patch<ActionResponse>(`/bookings/${encode(id)}/guest/change-time`, payload, { headers: guestHeaders(token) }),

  guestChangeTable: (id: string, token: string, table: { tableId?: string; tableNumber?: string }) =>
    api.patch<ActionResponse>(`/bookings/${encode(id)}/guest/change-table`, table, { headers: guestHeaders(token) }),

  guestAcknowledgeNotification: (id: string, token: string) =>
    api.patch<ActionResponse>(`/bookings/${encode(id)}/guest/notification/ack`, undefined, { headers: guestHeaders(token) }),

  guestReview: (id: string, token: string, payload: { text: string }) =>
    api.post<ActionResponse>(`/bookings/${encode(id)}/guest/review`, payload, { headers: guestHeaders(token) }),

  guestExternalReviewOpened: (id: string, token: string) =>
    api.patch<ActionResponse>(`/bookings/${encode(id)}/guest/review/external-opened`, undefined, { headers: guestHeaders(token) }),

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

  waiterTransfer: (id: string, tableId: string) =>
    api.patch<ActionResponse>(`/bookings/${encode(id)}/waiter-transfer`, { tableId }),
};
