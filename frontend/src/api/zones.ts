import { api } from './client';
import type { Zone } from './types';

export const zonesApi = {
  getAll: () => api.get<Zone[]>('/zones'),

  // Директор
  close: (zoneId: string) => api.patch<Zone>(`/zones/${zoneId}/close`, {}),
  open: (zoneId: string) => api.patch<Zone>(`/zones/${zoneId}/open`, {}),

  // Адміністратор — backend перевіряє, чи Директор надав право
  adminClose: (zoneId: string) => api.patch<Zone>(`/zones/${zoneId}/admin/close`, {}),
  adminOpen: (zoneId: string) => api.patch<Zone>(`/zones/${zoneId}/admin/open`, {}),
};
