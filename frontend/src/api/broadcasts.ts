import { api } from './client';

export type BroadcastSendResult = {
  message: string;
  recipientCount: number;
  deliveredCount: number;
  unreachableCount: number;
};

export const broadcastsApi = {
  sendNow: (payload: { message: string; target: 'all_clients' | 'selected_clients'; clientIds?: string[] }) =>
    api.post<BroadcastSendResult>('/broadcasts/send-now', payload),
};
