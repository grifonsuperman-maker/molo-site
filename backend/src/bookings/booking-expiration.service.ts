import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, Repository } from 'typeorm';

import { Booking, BookingStatus } from './entities/booking.entity';

const ACTIVE_STATUSES: BookingStatus[] = ['pending', 'approved'];
const CHECK_INTERVAL_MS = 60_000;

@Injectable()
export class BookingExpirationService implements OnModuleInit {
  private readonly logger = new Logger(BookingExpirationService.name);
  private isRunning = false;

  constructor(
    @InjectRepository(Booking)
    private readonly bookings: Repository<Booking>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.completeExpiredBookings();
  }

  @Interval(CHECK_INTERVAL_MS)
  async completeExpiredBookings(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;

    try {
      const today = this.getKyivDate();

      const expiredBookings = await this.bookings.find({
        where: {
          bookingDate: LessThan(today),
          status: In(ACTIVE_STATUSES),
        },
        order: {
          bookingDate: 'ASC',
          bookingTime: 'ASC',
        },
      });

      if (expiredBookings.length === 0) {
        return;
      }

      const completedAt = new Date();

      for (const booking of expiredBookings) {
        booking.status = 'completed';
        booking.completedAt ??= completedAt;
      }

      await this.bookings.save(expiredBookings);

      this.logger.log(
        `Automatically completed ${expiredBookings.length} expired booking(s) before ${today}`,
      );
    } catch (error: unknown) {
      this.logger.error(
        'Failed to automatically complete expired bookings',
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      this.isRunning = false;
    }
  }

  private getKyivDate(): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Kyiv',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());

    const year = parts.find((part) => part.type === 'year')?.value;
    const month = parts.find((part) => part.type === 'month')?.value;
    const day = parts.find((part) => part.type === 'day')?.value;

    if (!year || !month || !day) {
      throw new Error('Could not determine the current Kyiv date');
    }

    return `${year}-${month}-${day}`;
  }
}
