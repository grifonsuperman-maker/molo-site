import { api, setAccessToken } from './client';

export type StaffRole = 'owner' | 'admin' | 'waiter' | 'hookah';

export type StaffMember = {
  id: string;
  telegramId: string | null;
  fullName: string;
  phone: string | null;
  role: StaffRole;
  note: string | null;
  active: boolean;
  isArchived: boolean;
  isOnShift: boolean;
  shiftStartedAt: string | null;
  shiftStartedBy: string | null;
  shiftEndedAt: string | null;
  shiftEndedBy: string | null;
  lastAutoShiftEndDate: string | null;
  archivedAt: string | null;
  archivedBy: string | null;
  hasPin: boolean;
  createdAt: string;
  updatedAt: string;
};

export type StaffLoginOption = {
  id: string;
  fullName: string;
  role: StaffRole;
  isOnShift: boolean;
};

export type StaffAuthUser = {
  sub: string;
  telegramId: string;
  staffId: string | null;
  role: StaffRole;
  name: string | null;
};

export type StaffPinLoginResponse = {
  accessToken: string;
  user: StaffAuthUser;
  staff: StaffMember;
};

export type CreateStaffPayload = {
  fullName: string;
  phone?: string;
  telegramId?: string;
  role: StaffRole;
  pin?: string;
  note?: string;
};

export type UpdateStaffPayload = Partial<CreateStaffPayload>;

export type StaffShiftActionPayload = {
  performedBy?: string;
  comment?: string;
};

export type StaffShiftEventType =
  | 'shift_started'
  | 'shift_ended'
  | 'shift_auto_ended'
  | 'archived'
  | 'restored';

export type StaffShiftEvent = {
  id: string;
  eventType: StaffShiftEventType;
  performedBy: string | null;
  comment: string | null;
  createdAt: string;
};

export const staffApi = {
  getLoginOptions: () =>
    api.get<StaffLoginOption[]>('/staff/login-options'),

  loginWithPin: async (staffId: string, pin: string) => {
    const result = await api.post<StaffPinLoginResponse>(
      '/staff/pin-login',
      { staffId, pin },
    );

    setAccessToken(result.accessToken);
    return result;
  },

  getAll: () =>
    api.get<StaffMember[]>('/staff'),

  getOne: (id: string) =>
    api.get<StaffMember>(`/staff/${id}`),

  create: (payload: CreateStaffPayload) =>
    api.post<StaffMember>('/staff', payload),

  update: (id: string, payload: UpdateStaffPayload) =>
    api.patch<StaffMember>(`/staff/${id}`, payload),

  getHistory: (id: string) =>
    api.get<StaffShiftEvent[]>(`/staff/${id}/history`),

  startShift: (
    id: string,
    payload: StaffShiftActionPayload = {},
  ) =>
    api.post<StaffMember>(`/staff/${id}/shift/start`, payload),

  endShift: (
    id: string,
    payload: StaffShiftActionPayload = {},
  ) =>
    api.post<StaffMember>(`/staff/${id}/shift/end`, payload),

  block: (id: string) =>
    api.patch<StaffMember>(`/staff/${id}/block`),

  unblock: (id: string) =>
    api.patch<StaffMember>(`/staff/${id}/unblock`),

  archive: (
    id: string,
    payload: StaffShiftActionPayload = {},
  ) =>
    api.post<StaffMember>(`/staff/${id}/archive`, payload),

  restore: (
    id: string,
    payload: StaffShiftActionPayload = {},
  ) =>
    api.post<StaffMember>(`/staff/${id}/restore`, payload),

  remove: (id: string) =>
    api.delete<StaffMember>(`/staff/${id}`),
};
