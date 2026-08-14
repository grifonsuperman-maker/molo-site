import { api } from "./client";
import { guestBookingHeaders } from "./guestBookingAccess";

export type HookahCallStatus = "new" | "accepted" | "completed" | "cancelled";

export type HookahCall = {
  id: string;
  bookingId: string | null;
  tableId: string | null;
  tableNumber: string | null;
  zoneName: string | null;
  clientName: string | null;
  status: HookahCallStatus;
  acceptedByStaffId: string | null;
  acceptedByStaffName: string | null;
  etaMinutes: number | null;
  etaDueAt: string | null;
  waiterName: string | null;
  createdAt: string;
  acceptedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
};

export type GuestHookahStatus = {
  bookingId: string;
  bookingStatus: string;
  tableStatus: string | null;
  tableNumber: string | null;
  zoneName: string | null;
  canCall: boolean;
  hookahCallsAvailable: boolean;
  activeCall: HookahCall | null;
};

export type HookahAvailability = {
  available: boolean;
  changedAt: string | null;
  message?: string;
};

export type HookahCallActionResponse = {
  message: string;
  call: HookahCall;
};

export const hookahCallsApi = {
  getAvailability: () =>
    api.get<HookahAvailability>("/hookah-calls/availability"),

  setAvailability: (available: boolean) =>
    api.post<HookahAvailability>("/hookah-calls/availability", { available }),

  getGuestStatus: (bookingId: string) =>
    api.get<GuestHookahStatus>(
      `/hookah-calls/guest/${encodeURIComponent(bookingId)}/status`,
      { headers: guestBookingHeaders(bookingId) },
    ),

  createFromGuest: (bookingId: string) =>
    api.post<HookahCallActionResponse>(
      "/hookah-calls/guest",
      { bookingId },
      { headers: guestBookingHeaders(bookingId) },
    ),

  getActive: () => api.get<HookahCall[]>("/hookah-calls/active"),

  getMine: () => api.get<HookahCall[]>("/hookah-calls/mine"),

  accept: (id: string, etaMinutes: number) =>
    api.post<HookahCallActionResponse>(`/hookah-calls/${id}/accept`, {
      etaMinutes,
    }),

  complete: (id: string) =>
    api.post<HookahCallActionResponse>(`/hookah-calls/${id}/complete`, {}),

  cancel: (id: string, reason: string) =>
    api.post<HookahCallActionResponse>(`/hookah-calls/${id}/cancel`, {
      reason,
    }),
};
