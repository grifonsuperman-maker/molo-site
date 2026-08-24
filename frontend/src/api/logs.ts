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

export type LogPage = {
  items: LogRecord[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
};

type LogPageOptions = {
  page?: number;
  limit?: number;
};

type LogMutationResult = {
  ok: boolean;
  id: string;
};

function getLogPage(path: string, {
  page = 1,
  limit = 50,
}: LogPageOptions = {}) {
  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit),
  });
  return api.get<LogPage>(`${path}?${params.toString()}`);
}

async function getRecentActiveLogs() {
  const result = await getLogPage('/logs/active', { page: 1, limit: 300 });
  return result.items;
}

export const logsApi = {
  getAll: getRecentActiveLogs,
  getActive: (options: LogPageOptions = {}) => getLogPage('/logs/active', options),
  getArchive: (options: LogPageOptions = {}) => getLogPage('/logs/archive', options),
  archive: (id: string) =>
    api.patch<LogMutationResult>(`/logs/${encodeURIComponent(id)}/archive`),
  deletePermanently: (id: string) =>
    api.delete<LogMutationResult>(`/logs/${encodeURIComponent(id)}`),
};
