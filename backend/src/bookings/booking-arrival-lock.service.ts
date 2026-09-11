import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { Booking } from './entities/booking.entity';

@Injectable()
export class BookingArrivalLockService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Booking)
    private readonly bookings: Repository<Booking>,
  ) {}

  async withLock<T>(bookingId: string, work: () => Promise<T>) {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();

    try {
      await runner.query(
        'SELECT pg_advisory_lock(hashtext($1::text), hashtext($2::text))',
        [`booking:${bookingId}`, 'arrival-state'],
      );
      return await work();
    } finally {
      try {
        await runner.query(
          'SELECT pg_advisory_unlock(hashtext($1::text), hashtext($2::text))',
          [`booking:${bookingId}`, 'arrival-state'],
        );
      } finally {
        await runner.release();
      }
    }
  }

  async withCheckInLock<T>(bookingId: string, work: () => Promise<T>) {
    return this.withLock(bookingId, async () => {
      const current = await this.bookings.findOne({ where: { id: bookingId } });
      if (
        current?.status === 'cancelled' &&
        current.cancellationReason === 'no_show'
      ) {
        throw new BadRequestException('Бронювання вже анульовано через неявку');
      }
      return work();
    });
  }
}
