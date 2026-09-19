import { api } from '../../api/client';
import type { GuestBooking } from '../../api/bookings';

export type NoShowNotice = {
  noticeHandle: string;
  guestNotification: NonNullable<GuestBooking['guestNotification']>;
};

export const noShowNoticeApi = {
  listUnreadForDevice: (guestDeviceId: string) =>
    api.post<NoShowNotice[]>('/bookings/guest/no-show/notices', { guestDeviceId }),
  acknowledgeByDevice: (noticeHandle: string, guestDeviceId: string) =>
    api.patch<{ message: string }>(
      `/bookings/${encodeURIComponent(noticeHandle)}/guest/no-show/ack-by-device`,
      { guestDeviceId },
    ),
};
