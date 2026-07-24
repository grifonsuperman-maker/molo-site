import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { BookingRescheduleApprovalService } from './booking-reschedule-approval.service';
import { BookingsService } from './bookings.service';
import { BookingHistory } from './entities/booking-history.entity';
import { BookingRescheduleRequest } from './entities/booking-reschedule-request.entity';
import { Booking } from './entities/booking.entity';

@Injectable()
export class AdminRescheduleActionsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly approval: BookingRescheduleApprovalService,
    private readonly bookings: BookingsService,
  ) {}

  async approve(requestId: string) {
    const before = await this.findRequest(requestId);
    const previousDate = before.booking.bookingDate;
    const previousTime = before.booking.bookingTime;

    const result = await this.approval.approve(requestId);

    try {
      const request = await this.findRequest(requestId);
      const booking = request.booking;
      booking.guestNotification = {
        type: 'booking_updated',
        title: 'Час бронювання змінено',
        message: `Бронювання перенесено з ${this.dateLabel(previousDate)} · ${this.timeLabel(previousTime)} на ${this.dateLabel(booking.bookingDate)} · ${this.timeLabel(booking.bookingTime)}.`,
        previousTableNumber: booking.table?.tableNumber || null,
        newTableNumber: booking.table?.tableNumber || null,
        createdAt: new Date().toISOString(),
      };
      await this.dataSource.getRepository(Booking).save(booking);
      await this.saveHistory(
        booking,
        'admin_approved_time_change',
        `Новий час: ${booking.bookingDate} ${this.timeLabel(booking.bookingTime)}`,
      );
    } catch (notificationError) {
      console.error('Guest reschedule approval notification failed', notificationError);
    }

    return result;
  }

  async reject(requestId: string, adminComment?: string) {
    const before = await this.findRequest(requestId);
    const result = await this.bookings.rejectReschedule(requestId, {
      adminComment: String(adminComment || '').trim() || undefined,
    });

    try {
      const booking = before.booking;
      booking.guestNotification = {
        type: 'booking_updated',
        title: 'Запит на зміну часу відхилено',
        message:
          String(adminComment || '').trim() ||
          `Бронювання залишається на ${this.dateLabel(booking.bookingDate)} · ${this.timeLabel(booking.bookingTime)}.`,
        previousTableNumber: booking.table?.tableNumber || null,
        newTableNumber: booking.table?.tableNumber || null,
        createdAt: new Date().toISOString(),
      };
      await this.dataSource.getRepository(Booking).save(booking);
      await this.saveHistory(
        booking,
        'admin_rejected_time_change',
        String(adminComment || '').trim() || null,
      );
    } catch (notificationError) {
      console.error('Guest reschedule rejection notification failed', notificationError);
    }

    return result;
  }

  private async findRequest(requestId: string) {
    const request = await this.dataSource
      .getRepository(BookingRescheduleRequest)
      .findOne({
        where: { id: requestId },
        relations: [
          'booking',
          'booking.table',
          'booking.table.zone',
          'booking.client',
        ],
      });

    if (!request) throw new NotFoundException('Запит на зміну часу не знайдено');
    return request;
  }

  private async saveHistory(
    booking: Booking,
    action: string,
    reason: string | null,
  ) {
    const repository = this.dataSource.getRepository(BookingHistory);
    await repository.save(
      repository.create({
        booking,
        action,
        actorRole: 'admin',
        actorStaffId: null,
        actorName: null,
        previousData: null,
        newData: {
          bookingDate: booking.bookingDate,
          bookingTime: booking.bookingTime,
        },
        reason,
        isManualMode: false,
      }),
    );
  }

  private dateLabel(value: string) {
    const [year, month, day] = String(value || '').split('-');
    return year && month && day ? `${day}.${month}.${year}` : value || '-';
  }

  private timeLabel(value: string) {
    const [hours = '00', minutes = '00'] = String(value || '').split(':');
    return `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}`;
  }
}
