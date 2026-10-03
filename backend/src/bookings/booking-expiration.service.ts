import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, LessThan, Repository } from 'typeorm';

import { TableEntity, TableStatus } from '../tables/entities/table.entity';
import { Booking, BookingStatus } from './entities/booking.entity';
import { bookingTableAssignmentsReady } from './booking-table-assignment-transfer';

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
      const result = await this.bookings.manager.transaction(async (manager) => {
        const bookings = manager.getRepository(Booking);
        const assignmentsReady = await bookingTableAssignmentsReady(manager);

        const expiredCandidates = await bookings.find({
          where: {
            bookingDate: LessThan(today),
            status: In(ACTIVE_BOOKING_STATUSES),
          },
          order: {
            bookingDate: 'ASC',
            bookingTime: 'ASC',
          },
        });

        const candidateIds = expiredCandidates
          .filter((booking) => booking.status === 'pending' || Boolean(booking.checkedInAt))
          .map((booking) => booking.id)
          .sort();

        if (candidateIds.length === 0) {
          return { completed: 0, releasedTables: 0, preservedTables: 0 };
        }

        const completedAt = new Date();
        const completableBookings: Booking[] = [];
        const affectedTableIds = new Set<string>();

        for (const bookingId of candidateIds) {
          const locked = await bookings.findOne({
            where: { id: bookingId },
            lock: { mode: 'pessimistic_write' },
          });
          if (
            !locked ||
            locked.bookingDate >= today ||
            !ACTIVE_BOOKING_STATUSES.includes(locked.status) ||
            (locked.status !== 'pending' && !locked.checkedInAt)
          ) {
            continue;
          }

          const booking = await bookings.findOne({
            where: { id: bookingId },
            relations: assignmentsReady
              ? {
                  table: true,
                  tableAssignments: { table: true },
                }
              : {
                  table: true,
                },
          });
          if (!booking) continue;

          booking.status = 'completed';
          booking.completedAt ??= completedAt;
          completableBookings.push(booking);

          if (booking.table?.id) affectedTableIds.add(booking.table.id);
          if (assignmentsReady) {
            for (const assignment of booking.tableAssignments || []) {
              if (assignment.table?.id) affectedTableIds.add(assignment.table.id);
            }
          }
        }

        if (completableBookings.length === 0) {
          return { completed: 0, releasedTables: 0, preservedTables: 0 };
        }

        await bookings.save(completableBookings);

        let releasedTables = 0;
        let preservedTables = 0;

        for (const tableId of [...affectedTableIds].sort()) {
          const tableResult = await this.synchronizeTableStatus(
            manager,
            tableId,
            today,
            assignmentsReady,
          );

          if (tableResult === 'released') releasedTables += 1;
          if (tableResult === 'preserved') preservedTables += 1;
        }

        return {
          completed: completableBookings.length,
          releasedTables,
          preservedTables,
        };
      });

      if (result.completed === 0) {
        return;
      }

      this.logger.log(
        [
          `Automatically completed ${result.completed} expired booking(s)`,
          `before ${today}`,
          `released tables: ${result.releasedTables}`,
          `preserved tables: ${result.preservedTables}`,
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
    manager: EntityManager,
    tableId: string,
    today: string,
    assignmentsReady: boolean,
  ): Promise<'released' | 'preserved' | 'unchanged'> {
    const tables = manager.getRepository(TableEntity);
    const bookings = manager.getRepository(Booking);
    const table = await tables.findOne({
      where: { id: tableId },
      lock: { mode: 'pessimistic_write' },
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

    const todaysActiveBookings = assignmentsReady
      ? await bookings
        .createQueryBuilder('booking')
        .leftJoinAndSelect('booking.table', 'table')
        .leftJoin('booking.tableAssignments', 'tableAssignment')
        .leftJoin('tableAssignment.table', 'assignedTable')
        .where('(table.id = :tableId OR assignedTable.id = :tableId)', { tableId })
        .andWhere('booking.bookingDate = :today', { today })
        .andWhere('booking.status IN (:...statuses)', { statuses: ACTIVE_BOOKING_STATUSES })
        .distinct(true)
        .orderBy('booking.bookingTime', 'ASC')
        .getMany()
      : await bookings.find({
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
    await tables.save({ id: table.id, status: table.status });

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
