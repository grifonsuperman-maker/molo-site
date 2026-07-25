import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { DataSource, EntityManager, In } from 'typeorm';

import { TableEntity } from '../tables/entities/table.entity';
import { BookingHistory } from './entities/booking-history.entity';
import { Booking, BookingStatus } from './entities/booking.entity';

const ACTIVE_BOOKING_STATUSES: BookingStatus[] = ['pending', 'approved'];
const TABLE_CHANGE_RESOLUTIONS = [
  'admin_approved_table_change',
  'admin_rejected_table_change',
] as const;
const ADMIN_CALL_RESOLUTIONS = [
  'admin_accepted_call',
  'admin_completed_call',
] as const;
const DEFAULT_DURATION_MINUTES = 120;
const CLEANUP_MINUTES = 15;

@Injectable()
export class GuestRequestsService {
  constructor(private readonly dataSource: DataSource) {}

  async requestTableChange(
    bookingId: string,
    token: string,
    payload: { tableId?: string; tableNumber?: string },
  ) {
    const tableId = String(payload.tableId || '').trim();
    const tableNumber = String(payload.tableNumber || '').trim();
    if (!tableId && !tableNumber) {
      throw new BadRequestException('Оберіть бажаний стіл');
    }

    await this.dataSource.transaction(async (manager) => {
      const booking = await this.findOwnedBooking(bookingId, token, manager, true);
      if (!ACTIVE_BOOKING_STATUSES.includes(booking.status) || booking.checkedInAt) {
        throw new BadRequestException('Запит на зміну столу для цієї броні вже недоступний');
      }

      const existing = await this.findUnresolvedHistory(
        manager,
        booking.id,
        'guest_requested_table_change',
        TABLE_CHANGE_RESOLUTIONS,
      );
      if (existing) {
        throw new ConflictException('Запит на зміну столу вже очікує рішення Адміністратора');
      }

      let tableQuery = manager
        .getRepository(TableEntity)
        .createQueryBuilder('table')
        .leftJoinAndSelect('table.zone', 'zone')
        .setLock('pessimistic_write');
      tableQuery = tableId
        ? tableQuery.where('table.id = :tableId', { tableId })
        : tableQuery.where('table.tableNumber = :tableNumber', { tableNumber });

      const targetTable = await tableQuery.getOne();
      if (!targetTable) throw new BadRequestException('Стіл не знайдено');
      if (booking.table?.id === targetTable.id) {
        throw new BadRequestException('Оберіть інший стіл');
      }
      this.assertTableAvailable(targetTable);
      if (Number(targetTable.seats) < Number(booking.guestsCount)) {
        throw new BadRequestException('Для цієї кількості гостей потрібен більший стіл');
      }

      await this.assertNoConflict(manager, booking, targetTable.id);

      await manager.getRepository(BookingHistory).save(
        manager.getRepository(BookingHistory).create({
          booking,
          action: 'guest_requested_table_change',
          actorRole: 'guest',
          actorStaffId: null,
          actorName: null,
          previousData: {
            tableId: booking.table?.id || null,
            tableNumber: booking.table?.tableNumber || null,
          },
          newData: {
            requestedTableId: targetTable.id,
            requestedTableNumber: targetTable.tableNumber,
            requestedZoneName: targetTable.zone?.name || null,
          },
          reason: `Бажаний стіл №${targetTable.tableNumber}`,
          isManualMode: false,
        }),
      );
    });

    return { message: 'Запит на зміну столу надіслано Адміністратору' };
  }

  async callAdmin(bookingId: string, token: string) {
    await this.dataSource.transaction(async (manager) => {
      const booking = await this.findOwnedBooking(bookingId, token, manager, true);
      if (booking.status !== 'approved' || !booking.checkedInAt) {
        throw new BadRequestException('Виклик Адміністратора доступний після приходу гостей');
      }

      const existing = await this.findUnresolvedHistory(
        manager,
        booking.id,
        'guest_called_admin',
        ADMIN_CALL_RESOLUTIONS,
      );
      if (existing) {
        throw new ConflictException('Виклик Адміністратора вже активний');
      }

      await manager.getRepository(BookingHistory).save(
        manager.getRepository(BookingHistory).create({
          booking,
          action: 'guest_called_admin',
          actorRole: 'guest',
          actorStaffId: null,
          actorName: null,
          previousData: null,
          newData: {
            tableNumber: booking.table?.tableNumber || null,
          },
          reason: 'Гість викликав Адміністратора',
          isManualMode: false,
        }),
      );
    });

    return { message: 'Адміністратора викликано' };
  }

  private async findOwnedBooking(
    id: string,
    token: string,
    manager: EntityManager,
    lock: boolean,
  ) {
    const normalized = String(token || '').trim();
    if (!normalized || normalized.length > 256) {
      throw new UnauthorizedException('Недійсний доступ до бронювання');
    }

    let query = manager
      .getRepository(Booking)
      .createQueryBuilder('booking')
      .leftJoinAndSelect('booking.table', 'table')
      .leftJoinAndSelect('table.zone', 'zone')
      .leftJoinAndSelect('booking.client', 'client')
      .where('booking.id = :id', { id })
      .andWhere('booking.guestAccessTokenHash = :hash', {
        hash: createHash('sha256').update(normalized).digest('hex'),
      });

    if (lock) query = query.setLock('pessimistic_write', undefined, ['booking']);
    const booking = await query.getOne();
    if (!booking) throw new UnauthorizedException('Недійсний доступ до бронювання');
    return booking;
  }

  private async findUnresolvedHistory(
    manager: EntityManager,
    bookingId: string,
    requestAction: string,
    resolutionActions: readonly string[],
  ) {
    const repository = manager.getRepository(BookingHistory);
    const [requests, resolutions] = await Promise.all([
      repository.find({
        where: { booking: { id: bookingId }, action: requestAction } as any,
        relations: ['booking'],
        order: { createdAt: 'DESC' },
        take: 30,
      }),
      repository.find({
        where: {
          booking: { id: bookingId },
          action: In([...resolutionActions]),
        } as any,
        relations: ['booking'],
        order: { createdAt: 'DESC' },
        take: 60,
      }),
    ]);

    const resolved = new Set(
      resolutions
        .map((item) => String(item.newData?.requestId || ''))
        .filter(Boolean),
    );
    return requests.find((item) => !resolved.has(item.id)) || null;
  }

  private assertTableAvailable(table: TableEntity) {
    if (!table.isVisible || table.status === 'closed') {
      throw new BadRequestException('Цей стіл зараз недоступний');
    }
    if (table.zone?.isClosed || table.zone?.isVisible === false) {
      throw new BadRequestException('Ця локація зараз недоступна');
    }
  }

  private async assertNoConflict(
    manager: EntityManager,
    booking: Booking,
    tableId: string,
  ) {
    const requestedStart = this.timeToMinutes(booking.bookingTime);
    const requestedAvailableFrom =
      requestedStart + this.duration(booking) + CLEANUP_MINUTES;

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
      const start = this.timeToMinutes(candidate.bookingTime);
      const availableFrom = start + this.duration(candidate) + CLEANUP_MINUTES;
      return requestedStart < availableFrom && requestedAvailableFrom > start;
    });

    if (conflict) {
      throw new ConflictException('Цей стіл уже зайнятий на час бронювання');
    }
  }

  private duration(booking: Booking) {
    const stored = Number(booking.durationMinutes);
    if (Number.isFinite(stored) && stored >= 30) {
      return Math.min(720, Math.max(30, Math.round(stored)));
    }
    return DEFAULT_DURATION_MINUTES;
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
}
