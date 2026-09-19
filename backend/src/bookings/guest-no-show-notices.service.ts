import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { DataSource, Repository } from 'typeorm';

import { BookingHistory } from './entities/booking-history.entity';
import { Booking } from './entities/booking.entity';

const AUTOMATIC_NO_SHOW_REASON = 'automatic_no_show_30m';

@Injectable()
export class GuestNoShowNoticesService {
  constructor(
    @InjectRepository(Booking)
    private readonly bookings: Repository<Booking>,
    private readonly dataSource: DataSource,
  ) {}

  private deviceHash(deviceId: string | undefined) {
    const normalized = String(deviceId || '').trim();
    if (!normalized || normalized.length > 256) return null;
    return createHash('sha256').update(normalized).digest('hex');
  }

  // Return only the unread notice and the ID needed for its narrow acknowledgement.
  // Never expose a historical booking or its table/date/contact details by device.
  async listUnreadForDevice(deviceId: string | undefined) {
    const hash = this.deviceHash(deviceId);
    if (!hash) return [];

    const bookings = await this.bookings
      .createQueryBuilder('booking')
      .where('booking.guestDeviceIdHash = :deviceHash', { deviceHash: hash })
      .andWhere('booking.status = :cancelled', { cancelled: 'cancelled' })
      .andWhere('booking.cancellationReason = :reason', { reason: 'no_show' })
      .andWhere("booking.guest_notification ->> 'type' = :noticeType", { noticeType: 'no_show' })
      .andWhere("booking.guest_notification ->> 'reason' = :noticeReason", { noticeReason: AUTOMATIC_NO_SHOW_REASON })
      .andWhere("booking.guest_notification ->> 'acknowledgedAt' IS NULL")
      .orderBy('booking.cancelledAt', 'DESC')
      .getMany();

    return bookings.map((booking) => ({
      bookingId: booking.id,
      guestNotification: {
        type: booking.guestNotification!.type,
        title: booking.guestNotification!.title,
        message: booking.guestNotification!.message,
        createdAt: booking.guestNotification!.createdAt,
      },
    }));
  }

  // The device ID is a capability for acknowledging its own no-show notice only.
  // It must never grant access to other booking mutations or historical bookings.
  async acknowledgeByDevice(bookingId: string, deviceId: string | undefined) {
    const hash = this.deviceHash(deviceId);
    if (!hash) throw new UnauthorizedException('Недійсний доступ до повідомлення');

    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(Booking);
      const booking = await repository
        .createQueryBuilder('booking')
        .where('booking.id = :bookingId', { bookingId })
        .andWhere('booking.guestDeviceIdHash = :deviceHash', { deviceHash: hash })
        .setLock('pessimistic_write')
        .getOne();

      if (
        !booking ||
        booking.status !== 'cancelled' ||
        booking.cancellationReason !== 'no_show' ||
        booking.guestNotification?.type !== 'no_show' ||
        booking.guestNotification.reason !== AUTOMATIC_NO_SHOW_REASON
      ) {
        throw new UnauthorizedException('Недійсний доступ до повідомлення');
      }

      if (booking.guestNotification.acknowledgedAt) {
        return { message: 'Повідомлення прочитано' };
      }

      booking.guestNotification = {
        ...booking.guestNotification,
        acknowledgedAt: new Date().toISOString(),
      };
      await repository.save(booking);

      const history = manager.getRepository(BookingHistory);
      await history.save(history.create({
        booking,
        action: 'guest_acknowledged_notification',
        actorRole: 'guest',
        actorStaffId: null,
        actorName: null,
        previousData: null,
        newData: { guestNotification: booking.guestNotification },
        reason: null,
        isManualMode: false,
      }));

      return { message: 'Повідомлення прочитано' };
    });
  }
}
