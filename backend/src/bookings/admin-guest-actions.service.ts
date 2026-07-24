import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { DataSource, EntityManager, In } from 'typeorm';

import { TableEntity, TableStatus } from '../tables/entities/table.entity';
import { AvailabilityBlock } from './entities/availability-block.entity';
import { BookingHistory } from './entities/booking-history.entity';
import { BookingTableChangeRequest } from './entities/booking-table-change-request.entity';
import { Booking, BookingStatus } from './entities/booking.entity';
import { GuestReview } from './entities/guest-review.entity';

const ACTIVE_BOOKING_STATUSES: BookingStatus[] = ['pending', 'approved'];
const DEFAULT_DURATION_MINUTES = 120;
const CLEANUP_MINUTES = 15;

@Injectable()
export class AdminGuestActionsService {
  constructor(private readonly dataSource: DataSource) {}

  async requestTableChange(
    bookingId: string,
    token: string,
    requestedTableNumber?: string,
  ) {
    await this.dataSource.transaction(async (manager) => {
      const booking = await this.findOwnedBooking(
        manager,
        bookingId,
        token,
        true,
      );

      if (!ACTIVE_BOOKING_STATUSES.includes(booking.status) || booking.checkedInAt) {
        throw new BadRequestException(
          'Зміна столу для цього бронювання вже недоступна',
        );
      }

      const repository = manager.getRepository(BookingTableChangeRequest);
      let request = await repository.findOne({
        where: {
          booking: { id: booking.id },
          status: 'pending',
        } as any,
        relations: ['booking'],
        lock: { mode: 'pessimistic_write' },
      });

      const preferredNumber = String(requestedTableNumber || '').trim() || null;

      if (request) {
        request.requestedTableNumber = preferredNumber;
        request.adminComment = null;
      } else {
        request = repository.create({
          booking,
          requestedTableNumber: preferredNumber,
          selectedTable: null,
          status: 'pending',
          adminComment: null,
          resolvedAt: null,
        });
      }

      await repository.save(request);
      await this.saveHistory(manager, booking, 'guest_requested_table_change', {
        newData: {
          requestId: request.id,
          requestedTableNumber: preferredNumber,
        },
        reason: preferredNumber
          ? `Бажаний стіл №${preferredNumber}`
          : 'Гість просить підібрати інший стіл',
        actorRole: 'guest',
      });
    });

    return {
      message: 'Запит на зміну столу надіслано адміністратору',
    };
  }

  async pendingTableChanges() {
    return this.dataSource.getRepository(BookingTableChangeRequest).find({
      where: { status: 'pending' },
      relations: [
        'booking',
        'booking.table',
        'booking.table.zone',
        'booking.client',
      ],
      order: { createdAt: 'DESC' },
      take: 100,
    });
  }

  async reviews(limit?: number) {
    const take = Math.min(300, Math.max(1, Number(limit) || 150));
    return this.dataSource.getRepository(GuestReview).find({
      relations: [
        'booking',
        'booking.table',
        'booking.table.zone',
        'booking.client',
      ],
      order: { createdAt: 'DESC' },
      take,
    });
  }

  async approveTableChange(requestId: string, tableId: string) {
    if (!String(tableId || '').trim()) {
      throw new BadRequestException('Оберіть новий стіл');
    }

    return this.dataSource.transaction(async (manager) => {
      const requestRepository = manager.getRepository(BookingTableChangeRequest);
      const request = await requestRepository.findOne({
        where: { id: requestId },
        relations: [
          'booking',
          'booking.table',
          'booking.table.zone',
          'booking.client',
        ],
        lock: { mode: 'pessimistic_write' },
      });

      if (!request) throw new NotFoundException('Запит на зміну столу не знайдено');
      if (request.status !== 'pending') {
        throw new BadRequestException('Цей запит уже опрацьовано');
      }

      const bookingRepository = manager.getRepository(Booking);
      const booking = await bookingRepository.findOne({
        where: { id: request.booking.id },
        relations: ['table', 'table.zone', 'client'],
        lock: { mode: 'pessimistic_write' },
      });

      if (!booking || !booking.table) {
        throw new NotFoundException('Бронювання або поточний стіл не знайдено');
      }
      if (!ACTIVE_BOOKING_STATUSES.includes(booking.status) || booking.checkedInAt) {
        throw new BadRequestException('Зміна столу для цієї броні вже недоступна');
      }

      const tableRepository = manager.getRepository(TableEntity);
      const nextTable = await tableRepository.findOne({
        where: { id: tableId },
        relations: ['zone'],
        lock: { mode: 'pessimistic_write' },
      });

      if (!nextTable) throw new NotFoundException('Новий стіл не знайдено');
      if (nextTable.id === booking.table.id) {
        throw new BadRequestException('Оберіть інший стіл');
      }
      this.assertTableAvailable(nextTable);
      if (Number(nextTable.seats) < Number(booking.guestsCount)) {
        throw new BadRequestException('Обраний стіл не вміщує всіх гостей');
      }

      const oldTable = await tableRepository.findOne({
        where: { id: booking.table.id },
        relations: ['zone'],
        lock: { mode: 'pessimistic_write' },
      });
      if (!oldTable) throw new NotFoundException('Попередній стіл не знайдено');

      const requestedStart = this.timeToMinutes(booking.bookingTime);
      const requestedAvailableFrom =
        requestedStart + this.duration(booking) + CLEANUP_MINUTES;

      await this.assertNoAvailabilityBlock(
        manager,
        nextTable,
        booking.bookingDate,
        requestedStart,
        requestedAvailableFrom,
      );
      await this.assertNoBookingConflict(
        manager,
        booking,
        nextTable,
        requestedStart,
        requestedAvailableFrom,
      );

      const previousData = this.snapshot(booking);
      const previousTableNumber = oldTable.tableNumber;
      booking.table = nextTable;
      booking.guestNotification = {
        type: 'booking_updated',
        title: 'Стіл змінено',
        message: `Ваше бронювання перенесено зі столу №${previousTableNumber} на стіл №${nextTable.tableNumber}.`,
        previousTableNumber,
        newTableNumber: nextTable.tableNumber,
        createdAt: new Date().toISOString(),
      };
      await bookingRepository.save(booking);

      request.status = 'approved';
      request.selectedTable = nextTable;
      request.adminComment = null;
      request.resolvedAt = new Date();
      await requestRepository.save(request);

      await this.synchronizeTableForDate(
        manager,
        oldTable.id,
        booking.bookingDate,
        booking.id,
      );
      await this.applyBookingStatusToTable(
        manager,
        nextTable.id,
        booking.bookingDate,
        booking.status,
      );

      await this.saveHistory(manager, booking, 'admin_approved_table_change', {
        previousData,
        newData: this.snapshot(booking),
        reason: `Стіл №${previousTableNumber} → №${nextTable.tableNumber}`,
        actorRole: 'admin',
      });

      return {
        message: `Бронювання перенесено на стіл №${nextTable.tableNumber}`,
      };
    });
  }

  async rejectTableChange(requestId: string, adminComment?: string) {
    return this.dataSource.transaction(async (manager) => {
      const requestRepository = manager.getRepository(BookingTableChangeRequest);
      const request = await requestRepository.findOne({
        where: { id: requestId },
        relations: ['booking', 'booking.table', 'booking.client'],
        lock: { mode: 'pessimistic_write' },
      });

      if (!request) throw new NotFoundException('Запит на зміну столу не знайдено');
      if (request.status !== 'pending') {
        throw new BadRequestException('Цей запит уже опрацьовано');
      }

      request.status = 'rejected';
      request.adminComment = String(adminComment || '').trim() || null;
      request.resolvedAt = new Date();
      await requestRepository.save(request);

      const booking = await manager.getRepository(Booking).findOne({
        where: { id: request.booking.id },
        relations: ['table', 'client'],
        lock: { mode: 'pessimistic_write' },
      });
      if (!booking) throw new NotFoundException('Бронювання не знайдено');

      booking.guestNotification = {
        type: 'booking_updated',
        title: 'Запит на зміну столу відхилено',
        message:
          request.adminComment ||
          'Поточний стіл залишається закріпленим за вашим бронюванням.',
        previousTableNumber: booking.table?.tableNumber || null,
        newTableNumber: booking.table?.tableNumber || null,
        createdAt: new Date().toISOString(),
      };
      await manager.getRepository(Booking).save(booking);

      await this.saveHistory(manager, booking, 'admin_rejected_table_change', {
        newData: { requestId: request.id, status: request.status },
        reason: request.adminComment,
        actorRole: 'admin',
      });

      return { message: 'Запит на зміну столу відхилено' };
    });
  }

  private async findOwnedBooking(
    manager: EntityManager,
    id: string,
    token: string,
    lock = false,
  ) {
    const normalized = String(token || '').trim();
    if (!normalized || normalized.length > 256) {
      throw new UnauthorizedException('Недійсний доступ до бронювання');
    }

    let query = manager
      .getRepository(Booking)
      .createQueryBuilder('booking')
      .addSelect('booking.guestAccessTokenHash')
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

  private async assertNoAvailabilityBlock(
    manager: EntityManager,
    table: TableEntity,
    bookingDate: string,
    requestedStart: number,
    requestedAvailableFrom: number,
  ) {
    const blocks = await manager.getRepository(AvailabilityBlock).find({
      where: { blockDate: bookingDate },
      relations: ['table', 'zone'],
    });

    const conflict = blocks.find((block) => {
      const appliesToTable = block.table?.id === table.id;
      const appliesToZone = Boolean(
        block.zone?.id && table.zone?.id && block.zone.id === table.zone.id,
      );
      if (!appliesToTable && !appliesToZone) return false;
      if (!block.startTime || !block.endTime) return true;
      return (
        requestedStart < this.timeToMinutes(block.endTime) &&
        requestedAvailableFrom > this.timeToMinutes(block.startTime)
      );
    });

    if (conflict) {
      throw new BadRequestException(
        conflict.reason
          ? `На цей час стіл недоступний: ${conflict.reason}`
          : 'На цей час стіл недоступний',
      );
    }
  }

  private async assertNoBookingConflict(
    manager: EntityManager,
    booking: Booking,
    table: TableEntity,
    requestedStart: number,
    requestedAvailableFrom: number,
  ) {
    const candidates = await manager.getRepository(Booking).find({
      where: {
        table: { id: table.id },
        bookingDate: booking.bookingDate,
        status: In(ACTIVE_BOOKING_STATUSES),
      } as any,
      relations: ['table'],
    });

    const conflict = candidates.find((candidate) => {
      if (candidate.id === booking.id) return false;
      const existingStart = this.timeToMinutes(candidate.bookingTime);
      const existingAvailableFrom =
        existingStart + this.duration(candidate) + CLEANUP_MINUTES;
      return (
        requestedStart < existingAvailableFrom &&
        requestedAvailableFrom > existingStart
      );
    });

    if (conflict) {
      throw new ConflictException('Цей стіл має конфлікт у часі бронювання');
    }
  }

  private async synchronizeTableForDate(
    manager: EntityManager,
    tableId: string,
    bookingDate: string,
    excludeBookingId: string,
  ) {
    if (bookingDate !== this.kyivDate()) return;

    const repository = manager.getRepository(TableEntity);
    const table = await repository.findOne({
      where: { id: tableId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!table || ['closed', 'occupied', 'cleaning'].includes(table.status)) return;

    const active = await manager.getRepository(Booking).find({
      where: {
        table: { id: tableId },
        bookingDate,
        status: In(ACTIVE_BOOKING_STATUSES),
      } as any,
      relations: ['table'],
    });
    const remaining = active.filter((item) => item.id !== excludeBookingId);

    let nextStatus: TableStatus = 'free';
    if (remaining.some((item) => item.status === 'approved')) nextStatus = 'reserved';
    else if (remaining.some((item) => item.status === 'pending')) nextStatus = 'pending';

    table.status = nextStatus;
    await repository.save(table);
  }

  private async applyBookingStatusToTable(
    manager: EntityManager,
    tableId: string,
    bookingDate: string,
    bookingStatus: BookingStatus,
  ) {
    if (bookingDate !== this.kyivDate()) return;

    const repository = manager.getRepository(TableEntity);
    const table = await repository.findOne({
      where: { id: tableId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!table || ['closed', 'occupied', 'cleaning'].includes(table.status)) return;

    table.status = bookingStatus === 'approved' ? 'reserved' : 'pending';
    await repository.save(table);
  }

  private assertTableAvailable(table: TableEntity) {
    if (!table.isVisible || table.status === 'closed') {
      throw new BadRequestException('Стіл зараз недоступний');
    }
    if (table.zone?.isClosed || table.zone?.isVisible === false) {
      throw new BadRequestException('Локація цього столу зараз недоступна');
    }
  }

  private duration(booking: Booking) {
    const stored = Number(booking.durationMinutes);
    if (Number.isFinite(stored) && stored >= 30) {
      return Math.min(720, Math.max(30, Math.round(stored)));
    }

    const match = String(booking.wishes || '').match(
      /\((\d{2}:\d{2})\s*[—-]\s*(\d{2}:\d{2})\)/,
    );
    if (!match) return DEFAULT_DURATION_MINUTES;

    const start = this.timeToMinutes(match[1]);
    const end = this.timeToMinutes(match[2]);
    return Math.min(720, Math.max(30, end >= start ? end - start : end + 1440 - start));
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
      throw new BadRequestException('Невірний формат часу бронювання');
    }
    return hours * 60 + minutes;
  }

  private snapshot(booking: Booking) {
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

  private async saveHistory(
    manager: EntityManager,
    booking: Booking,
    action: string,
    data: {
      previousData?: Record<string, unknown> | null;
      newData?: Record<string, unknown> | null;
      reason?: string | null;
      actorRole: string;
    },
  ) {
    const repository = manager.getRepository(BookingHistory);
    await repository.save(
      repository.create({
        booking,
        action,
        actorRole: data.actorRole,
        actorStaffId: null,
        actorName: null,
        previousData: data.previousData || null,
        newData: data.newData || null,
        reason: data.reason || null,
        isManualMode: false,
      }),
    );
  }

  private kyivDate() {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Kyiv',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  }
}
