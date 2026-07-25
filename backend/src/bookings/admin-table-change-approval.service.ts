import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';

import type { AuthUser } from '../auth/types/auth-user.type';
import { TableEntity, TableStatus } from '../tables/entities/table.entity';
import { AvailabilityBlock } from './entities/availability-block.entity';
import { BookingHistory } from './entities/booking-history.entity';
import { Booking, BookingStatus } from './entities/booking.entity';

const ACTIVE_BOOKING_STATUSES: BookingStatus[] = ['pending', 'approved'];
const DEFAULT_DURATION_MINUTES = 120;
const CLEANUP_MINUTES = 15;

@Injectable()
export class AdminTableChangeApprovalService {
  constructor(private readonly dataSource: DataSource) {}

  async approve(requestId: string, tableId: string, actor?: AuthUser) {
    if (!tableId) throw new BadRequestException('Оберіть новий стіл');

    return this.dataSource.transaction(async (manager) => {
      const request = await this.findRequest(manager, requestId);
      await this.assertNotResolved(manager, request.id);

      const bookingRepository = manager.getRepository(Booking);
      const booking = await bookingRepository.findOne({
        where: { id: request.booking.id },
        relations: ['table', 'table.zone', 'client'],
        lock: { mode: 'pessimistic_write' },
      });
      if (!booking) throw new NotFoundException('Бронювання не знайдено');
      if (!ACTIVE_BOOKING_STATUSES.includes(booking.status) || booking.checkedInAt) {
        throw new BadRequestException('Зміна столу для цієї броні вже недоступна');
      }

      const oldTableId = booking.table?.id || null;
      if (oldTableId === tableId) throw new BadRequestException('Оберіть інший стіл');

      const lockIds = [...new Set([oldTableId, tableId].filter(Boolean) as string[])].sort();
      for (const lockedTableId of lockIds) {
        await manager.query(
          'SELECT pg_advisory_xact_lock(hashtext($1::text), hashtext($2::text))',
          [lockedTableId, booking.bookingDate],
        );
      }

      const tableRepository = manager.getRepository(TableEntity);
      const nextTable = await tableRepository.findOne({
        where: { id: tableId },
        relations: ['zone'],
        lock: { mode: 'pessimistic_write' },
      });
      if (!nextTable) throw new NotFoundException('Стіл не знайдено');
      this.assertTableAvailable(nextTable);
      if (Number(nextTable.seats) < Number(booking.guestsCount)) {
        throw new BadRequestException('Обраний стіл не вміщує всіх гостей');
      }

      const oldTable = oldTableId
        ? await tableRepository.findOne({
            where: { id: oldTableId },
            relations: ['zone'],
            lock: { mode: 'pessimistic_write' },
          })
        : null;
      const oldTableNumber = oldTable?.tableNumber || null;

      await this.assertNoAvailabilityBlock(manager, nextTable, booking);
      await this.assertNoBookingConflict(manager, nextTable.id, booking);

      booking.table = nextTable;
      booking.guestNotification = {
        type: 'booking_updated',
        title: 'Зміну столу підтверджено',
        message: `Ваш новий стіл — №${nextTable.tableNumber}`,
        previousTableNumber: oldTableNumber,
        newTableNumber: nextTable.tableNumber,
        createdAt: new Date().toISOString(),
      };
      await bookingRepository.save(booking);

      if (oldTable) {
        await this.synchronizeTableForDate(
          manager,
          oldTable.id,
          booking.bookingDate,
          oldTable,
        );
      }
      await this.synchronizeTableForDate(
        manager,
        nextTable.id,
        booking.bookingDate,
        nextTable,
      );

      await manager.getRepository(BookingHistory).save(
        manager.getRepository(BookingHistory).create({
          booking,
          action: 'admin_approved_table_change',
          actorRole: actor?.role || 'admin',
          actorStaffId: actor?.staffId || null,
          actorName: actor?.name || null,
          previousData: null,
          newData: {
            requestId: request.id,
            oldTableNumber,
            newTableNumber: nextTable.tableNumber,
          },
          reason: null,
          isManualMode: true,
        }),
      );

      return { message: `Бронювання перенесено на стіл №${nextTable.tableNumber}` };
    });
  }

  private async findRequest(manager: EntityManager, requestId: string) {
    const request = await manager.getRepository(BookingHistory).findOne({
      where: { id: requestId },
      relations: ['booking', 'booking.table', 'booking.client'],
      lock: { mode: 'pessimistic_write' },
    });
    if (!request) throw new NotFoundException('Подію не знайдено');
    if (request.action !== 'guest_requested_table_change') {
      throw new BadRequestException('Невірний тип події');
    }
    return request;
  }

  private async assertNotResolved(manager: EntityManager, requestId: string) {
    const resolutions = await manager.getRepository(BookingHistory).find({
      where: {
        action: In([
          'admin_approved_table_change',
          'admin_rejected_table_change',
        ]),
      },
      order: { createdAt: 'DESC' },
      take: 300,
    });
    if (
      resolutions.some(
        (resolution) => String(resolution.newData?.requestId || '') === requestId,
      )
    ) {
      throw new ConflictException('Цю подію вже опрацьовано');
    }
  }

  private assertTableAvailable(table: TableEntity) {
    if (!table.isVisible || table.status === 'closed') {
      throw new BadRequestException('Стіл зараз недоступний');
    }
    if (table.zone?.isClosed || table.zone?.isVisible === false) {
      throw new BadRequestException('Локація зараз недоступна');
    }
  }

  private async assertNoAvailabilityBlock(
    manager: EntityManager,
    table: TableEntity,
    booking: Booking,
  ) {
    const start = this.timeToMinutes(booking.bookingTime);
    const end = start + this.duration(booking) + CLEANUP_MINUTES;
    const blocks = await manager.getRepository(AvailabilityBlock).find({
      where: { blockDate: booking.bookingDate },
      relations: ['table', 'zone'],
    });
    const conflict = blocks.find((block) => {
      const applies =
        block.table?.id === table.id ||
        Boolean(block.zone?.id && table.zone?.id && block.zone.id === table.zone.id);
      if (!applies) return false;
      if (!block.startTime || !block.endTime) return true;
      return start < this.timeToMinutes(block.endTime) &&
        end > this.timeToMinutes(block.startTime);
    });
    if (conflict) {
      throw new BadRequestException(
        conflict.reason
          ? `Стіл недоступний: ${conflict.reason}`
          : 'Стіл недоступний на цей час',
      );
    }
  }

  private async assertNoBookingConflict(
    manager: EntityManager,
    tableId: string,
    booking: Booking,
  ) {
    const start = this.timeToMinutes(booking.bookingTime);
    const end = start + this.duration(booking) + CLEANUP_MINUTES;
    const candidates = await manager
      .getRepository(Booking)
      .createQueryBuilder('candidate')
      .leftJoin('candidate.table', 'table')
      .where('table.id = :tableId', { tableId })
      .andWhere('candidate.bookingDate = :bookingDate', {
        bookingDate: booking.bookingDate,
      })
      .andWhere('candidate.status IN (:...statuses)', {
        statuses: ACTIVE_BOOKING_STATUSES,
      })
      .andWhere('candidate.id != :bookingId', { bookingId: booking.id })
      .getMany();
    const conflict = candidates.some((candidate) => {
      const candidateStart = this.timeToMinutes(candidate.bookingTime);
      const candidateEnd = candidateStart + this.duration(candidate) + CLEANUP_MINUTES;
      return start < candidateEnd && end > candidateStart;
    });
    if (conflict) throw new ConflictException('Стіл зайнятий на час бронювання');
  }

  private async synchronizeTableForDate(
    manager: EntityManager,
    tableId: string,
    bookingDate: string,
    lockedTable?: TableEntity,
  ) {
    if (bookingDate !== this.kyivDate()) return;

    const tableRepository = manager.getRepository(TableEntity);
    const table = lockedTable || await tableRepository
      .createQueryBuilder('table')
      .where('table.id = :tableId', { tableId })
      .setLock('pessimistic_write')
      .getOne();
    if (!table) return;
    if (['closed', 'cleaning', 'occupied'].includes(table.status)) return;

    const activeBookings = await manager.getRepository(Booking).find({
      where: {
        table: { id: tableId },
        bookingDate,
        status: In(ACTIVE_BOOKING_STATUSES),
      } as any,
      relations: ['table'],
    });

    let nextStatus: TableStatus = 'free';
    if (activeBookings.some((item) => item.status === 'approved')) {
      nextStatus = 'reserved';
    } else if (activeBookings.some((item) => item.status === 'pending')) {
      nextStatus = 'pending';
    }

    if (table.status !== nextStatus) {
      table.status = nextStatus;
      await tableRepository.save(table);
    }
  }

  private duration(booking: Booking) {
    const stored = Number(booking.durationMinutes);
    return Number.isFinite(stored) && stored >= 30
      ? Math.min(720, Math.max(30, Math.round(stored)))
      : DEFAULT_DURATION_MINUTES;
  }

  private timeToMinutes(value: string) {
    const [hoursRaw, minutesRaw] = String(value || '').split(':');
    const hours = Number(hoursRaw);
    const minutes = Number(minutesRaw);
    if (
      !Number.isInteger(hours) ||
      !Number.isInteger(minutes) ||
      hours < 0 ||
      hours > 23 ||
      minutes < 0 ||
      minutes > 59
    ) {
      throw new BadRequestException('Невірний час бронювання');
    }
    return hours * 60 + minutes;
  }

  private kyivDate() {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Kyiv',
    }).format(new Date());
  }
}
