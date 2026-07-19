import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, Repository } from 'typeorm';

import { TableEntity, TableStatus } from '../tables/entities/table.entity';
import { Booking, BookingStatus } from './entities/booking.entity';

const ACTIVE_BOOKING_STATUSES: BookingStatus[] = ['pending', 'approved'];
const RELEASABLE_TABLE_STATUSES: TableStatus[] = [
  'pending',
  'reserved',
  'occupied',
];

const CHECK_INTERVAL_MS = 60_000;

@Injectable()
export class BookingExpirationService implements OnModuleInit {
  private readonly logger = new Logger(BookingExpirationService.name);
  private isRunning = false;

  constructor(
    @InjectRepository(Booking)
    private readonly bookings: Repository<Booking>,

    @InjectRepository(TableEntity)
    private readonly tables: Repository<TableEntity>,
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
          status: In(ACTIVE_BOOKING_STATUSES),
        },
        relations: {
          table: true,
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
      const affectedTableIds = new Set<string>();

      for (const booking of expiredBookings) {
        booking.status = 'completed';
        booking.completedAt ??= completedAt;

        if (booking.table?.id) {
          affectedTableIds.add(booking.table.id);
        }
      }

      await this.bookings.save(expiredBookings);

      let releasedTables = 0;
      let preservedTables = 0;

      for (const tableId of affectedTableIds) {
        const result = await this.synchronizeTableStatus(tableId, today);

        if (result === 'released') {
          releasedTables += 1;
        }

        if (result === 'preserved') {
          preservedTables += 1;
        }
      }

      this.logger.log(
        [
          `Automatically completed ${expiredBookings.length} expired booking(s)`,
          `before ${today}`,
          `released tables: ${releasedTables}`,
          `preserved tables: ${preservedTables}`,
        ].join('; '),
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

  private async synchronizeTableStatus(
    tableId: string,
    today: string,
  ): Promise<'released' | 'preserved' | 'unchanged'> {
    const table = await this.tables.findOne({
      where: {
        id: tableId,
      },
    });

    if (!table) {
      this.logger.warn(
        `Could not synchronize table ${tableId}: table was not found`,
      );

      return 'unchanged';
    }

    /*
     * Закрытый стол нельзя автоматически открывать.
     * Cleaning тоже не сбрасываем: это отдельное ручное состояние.
     */
    if (table.status === 'closed' || table.status === 'cleaning') {
      return 'preserved';
    }

    const todaysActiveBookings = await this.bookings.find({
      where: {
        table: {
          id: tableId,
        },
        bookingDate: today,
        status: In(ACTIVE_BOOKING_STATUSES),
      },
      relations: {
        table: true,
      },
      order: {
        bookingTime: 'ASC',
      },
    });

    /*
     * Если стол сейчас реально occupied, не понижаем его статус,
     * пока существует сегодняшняя активная бронь.
     */
    if (
      table.status === 'occupied' &&
      todaysActiveBookings.length > 0
    ) {
      return 'preserved';
    }

    const hasApprovedBooking = todaysActiveBookings.some(
      (booking) => booking.status === 'approved',
    );

    const hasPendingBooking = todaysActiveBookings.some(
      (booking) => booking.status === 'pending',
    );

    let nextStatus: TableStatus = table.status;

    if (hasApprovedBooking) {
      nextStatus = 'reserved';
    } else if (hasPendingBooking) {
      nextStatus = 'pending';
    } else if (RELEASABLE_TABLE_STATUSES.includes(table.status)) {
      nextStatus = 'free';
    }

    if (nextStatus === table.status) {
      return todaysActiveBookings.length > 0
        ? 'preserved'
        : 'unchanged';
    }

    table.status = nextStatus;
    await this.tables.save(table);

    return nextStatus === 'free' ? 'released' : 'preserved';
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
