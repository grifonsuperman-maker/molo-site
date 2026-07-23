import { api } from './client';

export type LogRecord = {
  id: string;
  action: string;
  details?: Record<string, unknown> | null;
  staff?: {
    id?: string;
    fullName?: string | null;
    role?: string | null;
  } | null;
  createdAt: string;
};

export const logsApi = {
  getAll: () => api.get<LogRecord[]>('/logs'),
};
