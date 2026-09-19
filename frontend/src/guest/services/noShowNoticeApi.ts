import { api } from '../../api/client';

export const noShowNoticeApi = {
  acknowledgeByDevice: (bookingId: string, guestDeviceId: string) =>
    api.patch<{ message: string }>(
      `/bookings/${encodeURIComponent(bookingId)}/guest/no-show/ack-by-device`,
      { guestDeviceId },
    ),
};
