import { api } from './client';
import type { Client } from './types';

function requireReason(action: 'blacklist' | 'unblacklist', provided?: string): string {
  const promptText = action === 'blacklist'
    ? 'Вкажіть обов’язкову причину блокування гостя:'
    : 'Вкажіть обов’язкову причину розблокування гостя:';
  const value = String(provided ?? window.prompt(promptText) ?? '').trim();
  if (value.length < 3) {
    throw new Error('Причина має містити щонайменше 3 символи');
  }
  return value;
}

export const clientsApi = {
  getAll: () => api.get<Client[]>('/clients'),
  getOne: (id: string) => api.get<Client>(`/clients/${encodeURIComponent(id)}`),
  blacklist: (id: string, reason?: string) =>
    api.patch<Client>(`/clients/${encodeURIComponent(id)}/blacklist`, {
      reason: requireReason('blacklist', reason),
    }),
  unblacklist: (id: string, reason?: string) =>
    api.patch<Client>(`/clients/${encodeURIComponent(id)}/unblacklist`, {
      reason: requireReason('unblacklist', reason),
    }),
};
