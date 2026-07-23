import { api } from './client';
import type { Client } from './types';

export const clientsApi = {
  getAll: () => api.get<Client[]>('/clients'),
  blacklist: (id: string) => api.patch<Client>(`/clients/${encodeURIComponent(id)}/blacklist`),
  unblacklist: (id: string) => api.patch<Client>(`/clients/${encodeURIComponent(id)}/unblacklist`),
};
