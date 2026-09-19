import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { DataSource, Repository } from 'typeorm';

import { BookingHistory } from './entities/booking-history.entity';
import { Booking } from './entities/booking.entity';

const AUTOMATIC_NO_SHOW_REASON = 'automatic_no_show_30m';
const DEFAULT_DURATION_MINUTES = 120;

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

  // Only unread *automatic* no-show notices are recoverable by device.
  // Other cancelled bookings and guest history remain token-scoped.
  async listUnreadForDevice(deviceId: string | undefined) {
    const hash = this.deviceHash(deviceId);
    if (!hash) return [];

    const bookings = await this.bookings
      .createQueryBuilder('booking')
      .leftJoinAndSelect('booking.table', 'table')
      .leftJoinAndSelect('table.zone', 'zone')
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
      status: booking.status,
      tableId: booking.table?.id || null,
      tableNumber: booking.table?.tableNumber || null,
      zoneId: booking.table?.zone?.id || null,
      zoneName: booking.table?.zone?.name || null,
      bookingDate: booking.bookingDate,
      bookingTime: booking.bookingTime,
      durationMinutes: this.duration(booking),
      guestsCount: booking.guestsCount,
      wishes: booking.wishes,
      createdAt: booking.createdAt,
      approvedAt: booking.approvedAt,
      rejectedAt: booking.rejectedAt,
      checkedInAt: booking.checkedInAt,
      cancelledAt: booking.cancelledAt,
      completedAt: booking.completedAt,
      cancellationReason: booking.cancellationReason,
      lateNotifiedAt: booking.lateNotifiedAt,
      latenessHours: booking.latenessHours,
      latenessMinutes: booking.latenessMinutes,
      expectedArrivalAt: booking.expectedArrivalAt,
      isLatenessPromptDue: false,
      isExpectedArrivalOverdue: false,
      canGuestCancel: false,
      canGuestChangeTable: false,
      canGuestChangeTime: false,
      canReportLateness: false,
      canLeaveReview: false,
      guestNotification: booking.guestNotification,
      restaurantPhone: null,
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

  private duration(booking: Booking) {
    if (Number.isFinite(Number(booking.durationMinutes)) && Number(booking.durationMinutes) >= 30) {
      return Math.min(720, Math.round(Number(booking.durationMinutes)));
    }
    const match = String(booking.wishes || '').match(/\((\d{2}:\d{2})\s*[—-]\s*(\d{2}:\d{2})\)/);
    if (!match) return DEFAULT_DURATION_MINUTES;
    const minutes = (time: string) => {
      const [hours, minutes] = time.split(':').map(Number);
      return hours * 60 + minutes;
    };
    const start = minutes(match[1]);
    const end = minutes(match[2]);
    return Math.min(720, Math.max(30, end >= start ? end - start : end + 1440 - start));
  }
}
