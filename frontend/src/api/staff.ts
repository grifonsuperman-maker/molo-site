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
  hasDirectorAccess?: boolean;
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
  mustConfigureDirectorAccess?: boolean;
};

export type DirectorAccessStatus = {
  configured: boolean;
  bootstrapAvailable: boolean;
  directors: Array<{
    id: string;
    fullName: string;
    configured: boolean;
  }>;
};

export type DirectorAccessSettings = {
  fullName: string;
  loginName: string;
  configured: boolean;
};

export type DirectorLoginPayload =
  | {
      staffId: string;
      temporaryPin: string;
    }
  | {
      loginName: string;
      password: string;
    };

export type UpdateDirectorAccessPayload = {
  fullName: string;
  loginName: string;
  currentPassword?: string;
  newPassword: string;
  confirmPassword: string;
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
  getDirectorAccessStatus: () =>
    api.get<DirectorAccessStatus>('/staff/director-access/status'),

  loginDirector: async (payload: DirectorLoginPayload) => {
    const result = await api.post<StaffPinLoginResponse>(
      '/staff/director-access/login',
      payload,
    );

    setAccessToken(result.accessToken);
    return result;
  },

  getDirectorAccess: () =>
    api.get<DirectorAccessSettings>('/staff/director-access'),

  updateDirectorAccess: (payload: UpdateDirectorAccessPayload) =>
    api.patch<DirectorAccessSettings>('/staff/director-access', payload),

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

  deletePermanently: (id: string) =>
    api.delete<{ id: string }>(`/staff/${id}/permanent`),

  remove: (id: string) =>
    api.delete<StaffMember>(`/staff/${id}`),
};
