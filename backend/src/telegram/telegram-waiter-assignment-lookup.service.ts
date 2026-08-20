import { Injectable } from '@nestjs/common';
import { DataSource, In, IsNull, Not } from 'typeorm';

import type { Booking } from '../bookings/entities/booking.entity';
import { WaiterCallRecord } from '../waiter-calls/entities/waiter-call.entity';

@Injectable()
export class TelegramWaiterAssignmentLookupService {
  constructor(private readonly dataSource: DataSource) {}

  async bookingIdsForWaiter(bookings: Booking[], waiterId: string) {
    if (!waiterId || bookings.length === 0) return [];

    const approvedBookings = bookings.filter(
      (booking) => booking.status === 'approved',
    );
    if (approvedBookings.length === 0) return [];

    const bookingById = new Map(
      approvedBookings.map((booking) => [booking.id, booking]),
    );
    const calls = await this.dataSource.getRepository(WaiterCallRecord).find({
      where: {
        booking: { id: In([...bookingById.keys()]) },
        waiterId: Not(IsNull()),
        assignmentActive: true,
      },
      relations: { booking: true },
      order: { acceptedAt: 'DESC', createdAt: 'DESC' },
    });

    const latestCallByBooking = new Map<string, WaiterCallRecord>();
    for (const call of calls) {
      const bookingId = call.booking?.id;
      if (bookingId && !latestCallByBooking.has(bookingId)) {
        latestCallByBooking.set(bookingId, call);
      }
    }

    return approvedBookings
      .filter((booking) => {
        const call = latestCallByBooking.get(booking.id);
        if (!call || call.waiterId !== waiterId) return false;

        if (!booking.approvedAt) return true;
        const assignedAt = call.acceptedAt || call.createdAt;
        return assignedAt.getTime() >= booking.approvedAt.getTime();
      })
      .map((booking) => booking.id);
  }
}
