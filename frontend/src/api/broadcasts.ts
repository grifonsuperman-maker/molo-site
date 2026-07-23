import { api } from './client';

export type BroadcastSendResult = {
  message: string;
  recipientCount: number;
  deliveredCount: number;
  unreachableCount: number;
};

type BroadcastPayload = {
  message: string;
  target: 'all_clients' | 'selected_clients';
  clientIds?: string[];
};

function confirmBroadcast(payload: BroadcastPayload): void {
  const text = payload.target === 'all_clients'
    ? 'Надіслати повідомлення усім гостям?'
    : `Надіслати повідомлення ${payload.clientIds?.length || 0} гостям?`;
  if (!window.confirm(text)) {
    throw new Error('Розсилку не надіслано');
  }
}

export const broadcastsApi = {
  sendNow: (payload: BroadcastPayload) => {
    confirmBroadcast(payload);
    return api.post<BroadcastSendResult>('/broadcasts/send-now', payload);
  },
};
