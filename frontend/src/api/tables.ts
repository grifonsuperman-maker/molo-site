import { api } from './client';
import type { TableItem, TableStatus } from './types';

export const tablesApi = {
  getAll: () => api.get<TableItem[]>('/tables'),
  setStatus: (id: string, status: TableStatus) => api.patch<TableItem>(`/tables/${id}/status`, { status }),
  setStatusByNumber: (tableNumber: string, status: TableStatus) =>
    api.patch<TableItem>(`/tables/number/${encodeURIComponent(tableNumber)}/status`, { status }),
  occupied: (id: string) => api.patch<TableItem>(`/tables/${id}/occupied`),
  cleaning: (id: string) => api.patch<TableItem>(`/tables/${id}/cleaning`),
  free: (id: string) => api.patch<TableItem>(`/tables/${id}/free`),
  close: (id: string) => api.patch<TableItem>(`/tables/${id}/close`),
  open: (id: string) => api.patch<TableItem>(`/tables/${id}/open`),
};
