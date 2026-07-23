import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Booking, BookingStatus } from './entities/booking.entity';

const DEFAULT_CALENDAR_DAYS = 180;
const MAX_CALENDAR_DAYS = 366;
const ACTIVE_BOOKING_STATUSES: BookingStatus[] = ['pending', 'approved'];

@Injectable()
export class BookingCalendarService {
  constructor(
    @InjectRepository(Booking)
    private readonly bookings: Repository<Booking>,
  ) {}

  private restaurantDateToday(): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Kyiv',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  }

  private addDays(date: string, days: number): string {
    const value = new Date(`${date}T00:00:00.000Z`);
    value.setUTCDate(value.getUTCDate() + days);
    return value.toISOString().slice(0, 10);
  }

  private normalizeDays(value?: string): number {
    if (value === undefined || value === '') return DEFAULT_CALENDAR_DAYS;

    const days = Number(value);
    if (!Number.isInteger(days) || days < 1) {
      throw new BadRequestException('Кількість днів має бути цілим додатним числом');
    }

    return Math.min(MAX_CALENDAR_DAYS, days);
  }

  async upcoming(daysValue?: string) {
    const days = this.normalizeDays(daysValue);
    const today = this.restaurantDateToday();
    const endDate = this.addDays(today, days - 1);

    const rows = await this.bookings
      .createQueryBuilder('booking')
      .select('booking.bookingDate', 'date')
      .addSelect('COUNT(*)', 'total')
      .addSelect(`COUNT(*) FILTER (WHERE booking.status = 'pending')`, 'pending')
      .addSelect(`COUNT(*) FILTER (WHERE booking.status = 'approved')`, 'approved')
      .addSelect('COALESCE(SUM(booking.guestsCount), 0)', 'guests')
      .where('booking.bookingDate >= :today', { today })
      .andWhere('booking.bookingDate <= :endDate', { endDate })
      .andWhere('booking.status IN (:...statuses)', { statuses: ACTIVE_BOOKING_STATUSES })
      .groupBy('booking.bookingDate')
      .orderBy('booking.bookingDate', 'ASC')
      .getRawMany<{
        date: string;
        total: string;
        pending: string;
        approved: string;
        guests: string;
      }>();

    const dates = rows.map((row) => ({
      date: String(row.date),
      total: Number(row.total || 0),
      pending: Number(row.pending || 0),
      approved: Number(row.approved || 0),
      guests: Number(row.guests || 0),
    }));

    return {
      today,
      endDate,
      days,
      total: dates.reduce((sum, item) => sum + item.total, 0),
      pending: dates.reduce((sum, item) => sum + item.pending, 0),
      approved: dates.reduce((sum, item) => sum + item.approved, 0),
      dates,
    };
  }
}
