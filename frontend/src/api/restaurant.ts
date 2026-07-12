import { api } from './client';
import type { Restaurant, SiteMode } from './types';

export const restaurantApi = {
  get: () => api.get<Restaurant>('/restaurant'),

  // Директор: повний доступ
  open: () => api.post('/restaurant/open'),
  openBooking: () => api.post('/restaurant/open-booking'),
  closeBooking: () => api.post('/restaurant/close-booking'),
  close: (message?: string) => api.post('/restaurant/close', { message }),
  update: (body: Partial<Restaurant>) => api.patch('/restaurant', body),

  // Адміністратор: тільки додаткові права, які увімкнув Директор
  adminOpenBooking: () => api.post('/restaurant/admin/open-booking'),
  adminCloseBooking: () => api.post('/restaurant/admin/close-booking'),
  adminOpen: () => api.post('/restaurant/admin/open'),
  adminClose: (message?: string) => api.post('/restaurant/admin/close', { message }),
  adminSetSiteMode: (siteMode: SiteMode) =>
    api.patch('/restaurant/admin/site-mode', { siteMode }),
  adminUpdateSettings: (body: Pick<Partial<Restaurant>, 'menuUrl' | 'closeMessage' | 'bookingClosedMessage'>) =>
    api.patch('/restaurant/admin/settings', body),
};
