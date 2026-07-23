import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { BookingHistory } from './entities/booking-history.entity';

const ADMIN_EVENT_ACTIONS = [
  'booking_created',
  'guest_cancelled',
  'guest_reported_lateness',
  'guest_changed_table',
] as const;

@Injectable()
export class AdminBookingEventsService {
  constructor(
    @InjectRepository(BookingHistory)
    private readonly histories: Repository<BookingHistory>,
  ) {}

  async findRecent(limit?: number) {
    const take = Math.min(300, Math.max(1, Number(limit) || 120));
    const rows = await this.histories.find({
      where: { action: In([...ADMIN_EVENT_ACTIONS]) },
      relations: ['booking', 'booking.table', 'booking.table.zone', 'booking.client'],
      order: { createdAt: 'DESC' },
      take,
    });

    return rows.map((row) => ({
      id: row.id,
      action: row.action,
      createdAt: row.createdAt,
      reason: row.reason,
      previousData: row.previousData,
      newData: row.newData,
      booking: row.booking,
    }));
  }
}
