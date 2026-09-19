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

  // A one-purpose opaque handle derived from a random booking UUID, the device
  // hash and this notification's creation time. It cannot be used as a booking ID
  // with the public status endpoint, and it requires the same device for ACK.
  private noticeHandle(booking: Booking, deviceHash: string) {
    return createHash('sha256')
      .update('molo:automatic-no-show:ack:v1\0')
      .update(deviceHash)
      .update('\0')
      .update(booking.id)
      .update('\0')
      .update(booking.guestNotification?.createdAt || '')
      .digest('hex');
  }

  private candidates(deviceHash: string) {
    return this.bookings
      .createQueryBuilder('booking')
      .where('booking.guestDeviceIdHash = :deviceHash', { deviceHash })
      .andWhere('booking.status = :cancelled', { cancelled: 'cancelled' })
      .andWhere('booking.cancellationReason = :reason', { reason: 'no_show' })
      .andWhere("booking.guest_notification ->> 'type' = :noticeType", { noticeType: 'no_show' })
      .andWhere("booking.guest_notification ->> 'reason' = :noticeReason", { noticeReason: AUTOMATIC_NO_SHOW_REASON });
  }

  // Device recovery returns ONLY the unread notice and an opaque ACK handle,
  // never a booking ID, a booking card, or historical booking details.
  async listUnreadForDevice(deviceId: string | undefined) {
    const hash = this.deviceHash(deviceId);
    if (!hash) return [];

    const bookings = await this.candidates(hash)
      .andWhere("booking.guest_notification ->> 'acknowledgedAt' IS NULL")
      .orderBy('booking.cancelledAt', 'DESC')
      .getMany();

    return bookings.map((booking) => ({
      noticeHandle: this.noticeHandle(booking, hash),
      guestNotification: {
        type: booking.guestNotification!.type,
        title: booking.guestNotification!.title,
        message: booking.guestNotification!.message,
        createdAt: booking.guestNotification!.createdAt,
      },
    }));
  }

  // A device + handle grants only acknowledgement, never historical booking
  // access or any other guest mutation. Recheck everything under the row lock.
  async acknowledgeByDevice(handle: string | undefined, deviceId: string | undefined) {
    const hash = this.deviceHash(deviceId);
    if (!hash || !/^[a-f0-9]{64}$/.test(handle || '')) {
      throw new UnauthorizedException('Недійсний доступ до повідомлення');
    }

    // Find the UUID privately; the device-facing API never exposes it.
    const matches = await this.candidates(hash).getMany();
    const candidate = matches.find((booking) => this.noticeHandle(booking, hash) === handle);
    if (!candidate) throw new UnauthorizedException('Недійсний доступ до повідомлення');

    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(Booking);
      const booking = await repository
        .createQueryBuilder('booking')
        .where('booking.id = :bookingId', { bookingId: candidate.id })
        .andWhere('booking.guestDeviceIdHash = :deviceHash', { deviceHash: hash })
        .setLock('pessimistic_write')
        .getOne();

      if (
        !booking ||
        booking.status !== 'cancelled' ||
        booking.cancellationReason !== 'no_show' ||
        booking.guestNotification?.type !== 'no_show' ||
        booking.guestNotification.reason !== AUTOMATIC_NO_SHOW_REASON ||
        this.noticeHandle(booking, hash) !== handle
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
