import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { DataSource, EntityManager, In, Repository } from 'typeorm';

import { TableEntity } from '../tables/entities/table.entity';
import { AvailabilityBlock } from './entities/availability-block.entity';
import { BookingHistory } from './entities/booking-history.entity';
import { BookingTableChangeRequest } from './entities/booking-table-change-request.entity';
import { Booking, BookingStatus } from './entities/booking.entity';
import { GuestReview } from './entities/guest-review.entity';

const ACTIVE_BOOKING_STATUSES: BookingStatus[] = ['pending', 'approved'];
const DEFAULT_DURATION_MINUTES = 120;
const CLEANUP_MINUTES = 15;

@Injectable()
export class AdminAttentionService {
  constructor(
    @InjectRepository(BookingTableChangeRequest)
    private readonly tableChanges: Repository<BookingTableChangeRequest>,
    @InjectRepository(GuestReview)
    private readonly reviews: Repository<GuestReview>,
    private readonly dataSource: DataSource,
  ) {}

  async dashboard() {
    const [tableChanges, reviews] = await Promise.all([
      this.tableChanges.find({
        where: { status: 'pending' },
        relations: ['booking', 'booking.table', 'booking.table.zone', 'booking.client', 'approvedTable'],
        order: { createdAt: 'DESC' },
        take: 100,
      }),
      this.reviews
        .createQueryBuilder('review')
        .leftJoinAndSelect('review.booking', 'booking')
        .leftJoinAndSelect('booking.table', 'table')
        .leftJoinAndSelect('table.zone', 'zone')
        .leftJoinAndSelect('booking.client', 'client')
        .leftJoin(
          'guest_review_archives',
          'review_archive',
          'review_archive.guest_review_id = review.id',
        )
        .where('review_archive.guest_review_id IS NULL')
        .orderBy('review.createdAt', 'DESC')
        .take(100)
        .getMany(),
    ]);

    return { tableChanges, reviews };
  }

  async requestTableChange(
    bookingId: string,
    token: string,
    requested: { tableId?: string; tableNumber?: string },
  ) {
    const requestId = await this.dataSource.transaction(async (manager) => {
      const booking = await this.findOwnedBooking(manager, bookingId, token);
      if (!ACTIVE_BOOKING_STATUSES.includes(booking.status) || booking.checkedInAt) {
        throw new BadRequestException('Запит на зміну столу для цієї броні вже недоступний');
      }

      const requestedTableNumber = await this.resolveRequestedTableNumber(manager, requested);
      const repository = manager.getRepository(BookingTableChangeRequest);
      let request = await this.findPendingTableChangeForUpdate(manager, booking.id);

      if (request) {
        request.requestedTableNumber = requestedTableNumber;
      } else {
        request = repository.create({
          booking,
          requestedTableNumber,
          approvedTable: null,
          status: 'pending',
          adminComment: null,
          resolvedAt: null,
        });
      }
      request = await repository.save(request);

      await manager.getRepository(BookingHistory).save(
        manager.getRepository(BookingHistory).create({
          booking,
          action: 'guest_requested_table_change',
          actorRole: 'guest',
          actorStaffId: null,
          actorName: null,
          previousData: this.bookingSnapshot(booking),
          newData: {
            ...this.bookingSnapshot(booking),
            requestedTableNumber,
            tableChangeRequestId: request.id,
          },
          reason: requestedTableNumber
            ? `Гість просить інший стіл, бажаний №${requestedTableNumber}`
            : 'Гість просить підібрати інший стіл',
          isManualMode: false,
        }),
      );

      return request.id;
    });

    return {
      message: 'Запит на зміну столу надіслано Адміністратору',
      requestId,
    };
  }

  async approveTableChange(requestId: string, tableId: string) {
    const normalizedTableId = String(tableId || '').trim();
    if (!normalizedTableId) throw new BadRequestException('Оберіть новий стіл');

    return this.dataSource.transaction(async (manager) => {
      const requestRepository = manager.getRepository(BookingTableChangeRequest);
      const request = await this.findTableChangeForUpdate(manager, requestId);
      if (!request) throw new NotFoundException('Запит на зміну столу не знайдено');
      if (request.status !== 'pending') throw new ConflictException('Цей запит уже опрацьовано');

      const bookingRepository = manager.getRepository(Booking);
      const booking = await this.findBookingForUpdate(manager, request.booking.id);
      if (!booking) throw new NotFoundException('Бронювання не знайдено');
      if (!ACTIVE_BOOKING_STATUSES.includes(booking.status) || booking.checkedInAt) {
        throw new BadRequestException('Зміна столу для цієї броні вже недоступна');
      }
      if (!booking.table) throw new BadRequestException('Для бронювання не призначено поточний стіл');

      const nextTable = await this.findTableForUpdate(manager, normalizedTableId);
      if (!nextTable) throw new NotFoundException('Новий стіл не знайдено');
      if (nextTable.id === booking.table.id) throw new BadRequestException('Оберіть інший стіл');
      this.assertTableCanReceiveBooking(nextTable, booking);
      await this.assertNoConflict(manager, nextTable, booking);
      await this.assertNoAvailabilityBlock(manager, nextTable, booking);

      const oldTable = await this.findTableForUpdate(manager, booking.table.id);
      if (!oldTable) throw new NotFoundException('Поточний стіл не знайдено');

      const previousData = this.bookingSnapshot(booking);
      booking.table = nextTable;
      booking.guestNotification = {
        type: 'booking_updated',
        title: 'Новий стіл підтверджено',
        message: `Ваше бронювання перенесено зі столу №${oldTable.tableNumber} на стіл №${nextTable.tableNumber}.`,
        previousTableNumber: oldTable.tableNumber,
        newTableNumber: nextTable.tableNumber,
        createdAt: new Date().toISOString(),
      };
      await bookingRepository.save(booking);

      request.status = 'approved';
      request.approvedTable = nextTable;
      request.resolvedAt = new Date();
      request.adminComment = null;
      await requestRepository.save(request);

      await manager.getRepository(BookingHistory).save(
        manager.getRepository(BookingHistory).create({
          booking,
          action: 'admin_approved_table_change',
          actorRole: 'admin',
          actorStaffId: null,
          actorName: null,
          previousData,
          newData: this.bookingSnapshot(booking),
          reason: `Стіл №${oldTable.tableNumber} → №${nextTable.tableNumber}`,
          isManualMode: true,
        }),
      );

      await this.synchronizeTableForDate(manager, oldTable.id, booking.bookingDate);
      await this.applyBookingStatusToTable(manager, nextTable.id, booking.bookingDate, booking.status);

      return {
        message: `Бронювання перенесено на стіл №${nextTable.tableNumber}`,
        tableNumber: nextTable.tableNumber,
      };
    });
  }

  async rejectTableChange(requestId: string, adminComment?: string) {
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(BookingTableChangeRequest);
      const request = await this.findTableChangeForUpdate(manager, requestId);
      if (!request) throw new NotFoundException('Запит на зміну столу не знайдено');
      if (request.status !== 'pending') throw new ConflictException('Цей запит уже опрацьовано');

      const comment = String(adminComment || '').trim() || null;
      request.status = 'rejected';
      request.adminComment = comment;
      request.resolvedAt = new Date();
      await repository.save(request);

      const booking = request.booking;
      booking.guestNotification = {
        type: 'booking_updated',
        title: 'Поточний стіл залишено',
        message: comment || 'Адміністратор не зміг підтвердити інший стіл для цього бронювання.',
        previousTableNumber: booking.table?.tableNumber || null,
        newTableNumber: booking.table?.tableNumber || null,
        createdAt: new Date().toISOString(),
      };
      await manager.getRepository(Booking).save(booking);

      await manager.getRepository(BookingHistory).save(
        manager.getRepository(BookingHistory).create({
          booking,
          action: 'admin_rejected_table_change',
          actorRole: 'admin',
          actorStaffId: null,
          actorName: null,
          previousData: this.bookingSnapshot(booking),
          newData: { ...this.bookingSnapshot(booking), tableChangeRejected: true },
          reason: comment,
          isManualMode: true,
        }),
      );

      return { message: 'Запит на зміну столу відхилено' };
    });
  }

  private async findOwnedBooking(manager: EntityManager, bookingId: string, token: string) {
    const normalizedToken = String(token || '').trim();
    if (!normalizedToken || normalizedToken.length > 256) {
      throw new UnauthorizedException('Недійсний доступ до бронювання');
    }

    const tokenHash = createHash('sha256').update(normalizedToken).digest('hex');
    const booking = await manager
      .getRepository(Booking)
      .createQueryBuilder('booking')
      .addSelect('booking.guestAccessTokenHash')
      .leftJoinAndSelect('booking.table', 'table')
      .leftJoinAndSelect('table.zone', 'zone')
      .leftJoinAndSelect('booking.client', 'client')
      .where('booking.id = :bookingId', { bookingId })
      .andWhere('booking.guestAccessTokenHash = :tokenHash', { tokenHash })
      .setLock('pessimistic_write', undefined, ['booking'])
      .getOne();

    if (!booking) throw new UnauthorizedException('Недійсний доступ до бронювання');
    return booking;
  }

  private async resolveRequestedTableNumber(
    manager: EntityManager,
    requested: { tableId?: string; tableNumber?: string },
  ) {
    const directNumber = String(requested?.tableNumber || '').trim();
    if (directNumber) return directNumber.slice(0, 32);

    const tableId = String(requested?.tableId || '').trim();
    if (!tableId) return null;
    const table = await manager.getRepository(TableEntity).findOne({ where: { id: tableId } });
    return table?.tableNumber || null;
  }

  private findPendingTableChangeForUpdate(manager: EntityManager, bookingId: string) {
    return manager
      .getRepository(BookingTableChangeRequest)
      .createQueryBuilder('request')
      .innerJoinAndSelect('request.booking', 'booking')
      .where('booking.id = :bookingId', { bookingId })
      .andWhere('request.status = :status', { status: 'pending' })
      .setLock('pessimistic_write', undefined, ['request'])
      .getOne();
  }

  private findTableChangeForUpdate(manager: EntityManager, requestId: string) {
    return manager
      .getRepository(BookingTableChangeRequest)
      .createQueryBuilder('request')
      .innerJoinAndSelect('request.booking', 'booking')
      .leftJoinAndSelect('booking.table', 'currentTable')
      .leftJoinAndSelect('currentTable.zone', 'currentZone')
      .leftJoinAndSelect('booking.client', 'client')
      .where('request.id = :requestId', { requestId })
      .setLock('pessimistic_write', undefined, ['request'])
      .getOne();
  }

  private findBookingForUpdate(manager: EntityManager, bookingId: string) {
    return manager
      .getRepository(Booking)
      .createQueryBuilder('booking')
      .leftJoinAndSelect('booking.table', 'currentTable')
      .leftJoinAndSelect('currentTable.zone', 'currentZone')
      .leftJoinAndSelect('booking.client', 'client')
      .where('booking.id = :bookingId', { bookingId })
      .setLock('pessimistic_write', undefined, ['booking'])
      .getOne();
  }

  private findTableForUpdate(manager: EntityManager, tableId: string) {
    return manager
      .getRepository(TableEntity)
      .createQueryBuilder('locked_table')
      .leftJoinAndSelect('locked_table.zone', 'zone')
      .where('locked_table.id = :tableId', { tableId })
      .setLock('pessimistic_write', undefined, ['locked_table'])
      .getOne();
  }

  private assertTableCanReceiveBooking(table: TableEntity, booking: Booking) {
    if (!table.isVisible || table.status === 'closed' || table.zone?.isClosed || table.zone?.isVisible === false) {
      throw new BadRequestException('Цей стіл або локація зараз недоступні');
    }
    if (this.isToday(booking.bookingDate) && ['occupied', 'cleaning'].includes(table.status)) {
      throw new BadRequestException('Цей стіл зараз зайнятий або готується');
    }
    if (Number(table.seats) < Number(booking.guestsCount)) {
      throw new BadRequestException('Обраний стіл не вміщує всіх гостей');
    }
  }

  private async assertNoConflict(manager: EntityManager, table: TableEntity, booking: Booking) {
    const requestedStart = this.timeToMinutes(booking.bookingTime);
    const requestedAvailableFrom = requestedStart + this.duration(booking) + CLEANUP_MINUTES;
    const candidates = await manager.getRepository(Booking)
      .createQueryBuilder('candidate')
      .leftJoin('candidate.table', 'table')
      .where('table.id = :tableId', { tableId: table.id })
      .andWhere('candidate.bookingDate = :bookingDate', { bookingDate: booking.bookingDate })
      .andWhere('candidate.status IN (:...statuses)', { statuses: ACTIVE_BOOKING_STATUSES })
      .andWhere('candidate.id != :bookingId', { bookingId: booking.id })
      .orderBy('candidate.bookingTime', 'ASC')
      .getMany();

    const conflict = candidates.find((candidate) => {
      const start = this.timeToMinutes(candidate.bookingTime);
      const availableFrom = start + this.duration(candidate) + CLEANUP_MINUTES;
      return requestedStart < availableFrom && requestedAvailableFrom > start;
    });
    if (conflict) throw new ConflictException('Цей стіл має інше бронювання у вибраний час');
  }

  private async assertNoAvailabilityBlock(manager: EntityManager, table: TableEntity, booking: Booking) {
    const requestedStart = this.timeToMinutes(booking.bookingTime);
    const requestedAvailableFrom = requestedStart + this.duration(booking) + CLEANUP_MINUTES;
    const blocks = await manager.getRepository(AvailabilityBlock).find({
      where: { blockDate: booking.bookingDate },
      relations: ['table', 'zone'],
    });

    const conflict = blocks.find((block) => {
      const appliesToTable = block.table?.id === table.id;
      const appliesToZone = Boolean(block.zone?.id && table.zone?.id && block.zone.id === table.zone.id);
      if (!appliesToTable && !appliesToZone) return false;
      if (!block.startTime || !block.endTime) return true;
      return requestedStart < this.timeToMinutes(block.endTime) && requestedAvailableFrom > this.timeToMinutes(block.startTime);
    });

    if (conflict) {
      throw new BadRequestException(conflict.reason ? `Стіл недоступний: ${conflict.reason}` : 'Стіл недоступний у цей час');
    }
  }

  private async synchronizeTableForDate(manager: EntityManager, tableId: string, bookingDate: string) {
    if (!this.isToday(bookingDate)) return;
    const repository = manager.getRepository(TableEntity);
    const table = await repository.findOne({
      where: { id: tableId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!table || ['closed', 'cleaning', 'occupied'].includes(table.status)) return;

    const active = await manager.getRepository(Booking).find({
      where: {
        table: { id: tableId },
        bookingDate,
        status: In(ACTIVE_BOOKING_STATUSES),
      } as any,
      relations: ['table'],
    });

    if (active.some((item) => item.status === 'approved')) table.status = 'reserved';
    else if (active.some((item) => item.status === 'pending')) table.status = 'pending';
    else table.status = 'free';
    await repository.save(table);
  }

  private async applyBookingStatusToTable(
    manager: EntityManager,
    tableId: string,
    bookingDate: string,
    bookingStatus: BookingStatus,
  ) {
    if (!this.isToday(bookingDate)) return;
    const repository = manager.getRepository(TableEntity);
    const table = await repository.findOne({
      where: { id: tableId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!table || ['closed', 'cleaning', 'occupied'].includes(table.status)) return;
    table.status = bookingStatus === 'approved' ? 'reserved' : 'pending';
    await repository.save(table);
  }

  private bookingSnapshot(booking: Booking) {
    return {
      status: booking.status,
      tableId: booking.table?.id || null,
      tableNumber: booking.table?.tableNumber || null,
      bookingDate: booking.bookingDate,
      bookingTime: booking.bookingTime,
      durationMinutes: this.duration(booking),
      checkedInAt: booking.checkedInAt,
    };
  }

  private duration(booking: Booking) {
    const stored = Number(booking.durationMinutes);
    if (Number.isFinite(stored) && stored >= 30) {
      return Math.min(720, Math.max(30, Math.round(stored)));
    }
    const match = String(booking.wishes || '').match(/\((\d{2}:\d{2})\s*[—-]\s*(\d{2}:\d{2})\)/);
    if (!match) return DEFAULT_DURATION_MINUTES;
    const start = this.timeToMinutes(match[1]);
    const end = this.timeToMinutes(match[2]);
    return Math.min(720, Math.max(30, end >= start ? end - start : end + 1440 - start));
  }

  private timeToMinutes(value: string) {
    const [hoursRaw, minutesRaw] = String(value || '').split(':');
    const hours = Number(hoursRaw);
    const minutes = Number(minutesRaw);
    if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
      throw new BadRequestException('Невірний формат часу');
    }
    return hours * 60 + minutes;
  }

  private isToday(date: string) {
    return String(date || '') === new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Kyiv',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  }
}
