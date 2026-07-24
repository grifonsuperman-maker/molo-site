import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';

import { TableEntity } from '../tables/entities/table.entity';
import { AvailabilityBlock } from './entities/availability-block.entity';
import { BookingHistory } from './entities/booking-history.entity';
import { BookingRescheduleRequest } from './entities/booking-reschedule-request.entity';
import { BookingTableChangeRequest } from './entities/booking-table-change-request.entity';
import { Booking } from './entities/booking.entity';
import { GuestReview } from './entities/guest-review.entity';
import { BookingRescheduleApprovalService } from './booking-reschedule-approval.service';
import { BookingsService } from './bookings.service';

const ACTIVE_BOOKING_STATUSES = ['pending', 'approved'] as const;
const CLEANUP_MINUTES = 15;
const DEFAULT_DURATION_MINUTES = 120;

@Injectable()
export class AdminGuestRequestsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly rescheduleApproval: BookingRescheduleApprovalService,
    private readonly bookingsService: BookingsService,
    @InjectRepository(BookingRescheduleRequest)
    private readonly reschedules: Repository<BookingRescheduleRequest>,
    @InjectRepository(BookingTableChangeRequest)
    private readonly tableChanges: Repository<BookingTableChangeRequest>,
    @InjectRepository(GuestReview)
    private readonly reviews: Repository<GuestReview>,
    @InjectRepository(Booking)
    private readonly bookings: Repository<Booking>,
  ) {}

  async list() {
    const [reschedules, tableChanges, reviews] = await Promise.all([
      this.reschedules.find({
        where: { status: 'pending' },
        relations: ['booking', 'booking.table', 'booking.table.zone', 'booking.client'],
        order: { createdAt: 'DESC' },
        take: 100,
      }),
      this.tableChanges.find({
        where: { status: 'pending' },
        relations: [
          'booking',
          'booking.table',
          'booking.table.zone',
          'booking.client',
          'selectedTable',
          'selectedTable.zone',
        ],
        order: { createdAt: 'DESC' },
        take: 100,
      }),
      this.reviews.find({
        relations: ['booking', 'booking.table', 'booking.table.zone', 'booking.client'],
        order: { createdAt: 'DESC' },
        take: 100,
      }),
    ]);

    return { reschedules, tableChanges, reviews };
  }

  async acknowledgeReview(reviewId: string) {
    const review = await this.reviews.findOne({ where: { id: reviewId } });
    if (!review) throw new NotFoundException('Відгук не знайдено');
    if (!review.acknowledgedAt) {
      review.acknowledgedAt = new Date();
      await this.reviews.save(review);
    }
    return { message: 'Відгук опрацьовано' };
  }

  async approveReschedule(requestId: string) {
    await this.rescheduleApproval.approve(requestId);
    const request = await this.reschedules.findOne({
      where: { id: requestId },
      relations: ['booking', 'booking.table', 'booking.client'],
    });
    if (!request?.booking) throw new NotFoundException('Запит не знайдено');

    request.booking.guestNotification = {
      type: 'booking_updated',
      title: 'Зміну часу підтверджено',
      message: `Нова дата і час: ${request.requestedDate} · ${this.timeLabel(request.requestedTime)}`,
      createdAt: new Date().toISOString(),
    };
    await this.bookings.save(request.booking);
    return { message: 'Новий час підтверджено' };
  }

  async rejectReschedule(requestId: string, adminComment?: string) {
    await this.bookingsService.rejectReschedule(requestId, { adminComment: adminComment || '' });
    const request = await this.reschedules.findOne({
      where: { id: requestId },
      relations: ['booking', 'booking.table', 'booking.client'],
    });
    if (!request?.booking) throw new NotFoundException('Запит не знайдено');

    request.booking.guestNotification = {
      type: 'booking_updated',
      title: 'Запит на зміну часу відхилено',
      message: String(adminComment || '').trim() || 'Зв’яжіться з рестораном, щоб підібрати інший час.',
      createdAt: new Date().toISOString(),
    };
    await this.bookings.save(request.booking);
    return { message: 'Запит на зміну часу відхилено' };
  }

  async approveTableChange(requestId: string, tableId: string) {
    const selectedTableId = String(tableId || '').trim();
    if (!selectedTableId) throw new BadRequestException('Оберіть новий стіл');

    return this.dataSource.transaction(async (manager) => {
      const requestRepository = manager.getRepository(BookingTableChangeRequest);
      const request = await requestRepository.findOne({
        where: { id: requestId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!request) throw new NotFoundException('Запит не знайдено');
      if (request.status !== 'pending') throw new BadRequestException('Цей запит уже опрацьовано');

      const preview = await requestRepository.findOne({
        where: { id: requestId },
        relations: ['booking', 'booking.table', 'booking.client'],
      });
      if (!preview?.booking) throw new NotFoundException('Бронювання не знайдено');

      const bookingRepository = manager.getRepository(Booking);
      const lockedBooking = await bookingRepository.findOne({
        where: { id: preview.booking.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!lockedBooking) throw new NotFoundException('Бронювання не знайдено');
      if (!ACTIVE_BOOKING_STATUSES.includes(lockedBooking.status as any) || lockedBooking.checkedInAt) {
        throw new BadRequestException('Зміна столу для цієї броні вже недоступна');
      }

      const booking = await bookingRepository.findOne({
        where: { id: lockedBooking.id },
        relations: ['table', 'table.zone', 'client'],
      });
      if (!booking?.table) throw new BadRequestException('Для бронювання не призначено стіл');

      const tableRepository = manager.getRepository(TableEntity);
      const nextTable = await tableRepository.findOne({
        where: { id: selectedTableId },
        relations: ['zone'],
        lock: { mode: 'pessimistic_write' },
      });
      if (!nextTable) throw new NotFoundException('Стіл не знайдено');
      if (nextTable.id === booking.table.id) throw new BadRequestException('Оберіть інший стіл');
      if (!nextTable.isVisible || nextTable.status === 'closed' || nextTable.zone?.isClosed || nextTable.zone?.isVisible === false) {
        throw new BadRequestException('Цей стіл зараз недоступний');
      }
      if (booking.bookingDate === this.kyivDate() && nextTable.status !== 'free') {
        throw new BadRequestException('На сьогодні можна обрати лише вільний стіл');
      }
      if (Number(nextTable.seats) < Number(booking.guestsCount)) {
        throw new BadRequestException('Обраний стіл не вміщує всіх гостей');
      }

      await this.assertTableTimeAvailable(manager, booking, nextTable);
      await this.assertNoAvailabilityBlock(manager, booking, nextTable);

      const oldTable = booking.table;
      const previousData = this.snapshot(booking);
      booking.table = nextTable;
      booking.guestNotification = {
        type: 'booking_updated',
        title: 'Зміну столу підтверджено',
        message: `Стіл №${oldTable.tableNumber} змінено на стіл №${nextTable.tableNumber}`,
        previousTableNumber: String(oldTable.tableNumber),
        newTableNumber: String(nextTable.tableNumber),
        createdAt: new Date().toISOString(),
      };
      await bookingRepository.save(booking);

      request.status = 'approved';
      request.selectedTable = nextTable;
      request.adminComment = null;
      request.resolvedAt = new Date();
      await requestRepository.save(request);

      await manager.getRepository(BookingHistory).save(
        manager.getRepository(BookingHistory).create({
          booking,
          action: 'admin_approved_table_change',
          actorRole: 'admin',
          actorStaffId: null,
          actorName: null,
          previousData,
          newData: this.snapshot(booking),
          reason: `Стіл №${oldTable.tableNumber} → №${nextTable.tableNumber}`,
          isManualMode: true,
        }),
      );

      await this.synchronizeTableForDate(manager, oldTable.id, booking.bookingDate);
      await this.synchronizeTableForDate(manager, nextTable.id, booking.bookingDate);

      return { message: `Бронювання перенесено на стіл №${nextTable.tableNumber}` };
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
      if (!request) throw new NotFoundException('Запит не знайдено');
      if (request.status !== 'pending') throw new BadRequestException('Цей запит уже опрацьовано');

      request.status = 'rejected';
      request.adminComment = String(adminComment || '').trim() || null;
      request.resolvedAt = new Date();
      await requestRepository.save(request);

      if (request.booking) {
        request.booking.guestNotification = {
          type: 'booking_updated',
          title: 'Запит на зміну столу відхилено',
          message: request.adminComment || 'Адміністратор не зміг підібрати інший стіл.',
          createdAt: new Date().toISOString(),
        };
        await manager.getRepository(Booking).save(request.booking);
        await manager.getRepository(BookingHistory).save(
          manager.getRepository(BookingHistory).create({
            booking: request.booking,
            action: 'admin_rejected_table_change',
            actorRole: 'admin',
            actorStaffId: null,
            actorName: null,
            previousData: null,
            newData: { requestStatus: 'rejected' },
            reason: request.adminComment,
            isManualMode: true,
          }),
        );
      }

      return { message: 'Запит на зміну столу відхилено' };
    });
  }

  private async assertTableTimeAvailable(
    manager: EntityManager,
    booking: Booking,
    table: TableEntity,
  ) {
    const requestedStart = this.timeToMinutes(booking.bookingTime);
    const requestedEnd = requestedStart + this.duration(booking) + CLEANUP_MINUTES;
    const candidates = await manager.getRepository(Booking).find({
      where: {
        table: { id: table.id },
        bookingDate: booking.bookingDate,
        status: In([...ACTIVE_BOOKING_STATUSES]),
      } as any,
      relations: ['table'],
    });

    const conflict = candidates.find((candidate) => {
      if (candidate.id === booking.id) return false;
      const start = this.timeToMinutes(candidate.bookingTime);
      const end = start + this.duration(candidate) + CLEANUP_MINUTES;
      return requestedStart < end && requestedEnd > start;
    });
    if (conflict) throw new BadRequestException('Цей стіл має конфлікт у часі бронювання');
  }

  private async assertNoAvailabilityBlock(
    manager: EntityManager,
    booking: Booking,
    table: TableEntity,
  ) {
    const start = this.timeToMinutes(booking.bookingTime);
    const end = start + this.duration(booking) + CLEANUP_MINUTES;
    const blocks = await manager.getRepository(AvailabilityBlock).find({
      where: { blockDate: booking.bookingDate },
      relations: ['table', 'zone'],
    });
    const conflict = blocks.find((block) => {
      const applies = block.table?.id === table.id || Boolean(block.zone?.id && block.zone.id === table.zone?.id);
      if (!applies) return false;
      if (!block.startTime || !block.endTime) return true;
      return start < this.timeToMinutes(block.endTime) && end > this.timeToMinutes(block.startTime);
    });
    if (conflict) throw new BadRequestException(conflict.reason || 'На цей час стіл недоступний');
  }

  private async synchronizeTableForDate(manager: EntityManager, tableId: string, bookingDate: string) {
    if (bookingDate !== this.kyivDate()) return;
    const tableRepository = manager.getRepository(TableEntity);
    const table = await tableRepository.findOne({ where: { id: tableId }, lock: { mode: 'pessimistic_write' } });
    if (!table || ['closed', 'occupied', 'cleaning'].includes(table.status)) return;

    const active = await manager.getRepository(Booking).find({
      where: {
        table: { id: tableId },
        bookingDate,
        status: In([...ACTIVE_BOOKING_STATUSES]),
      } as any,
      relations: ['table'],
    });
    table.status = active.some((item) => item.status === 'approved')
      ? 'reserved'
      : active.some((item) => item.status === 'pending')
        ? 'pending'
        : 'free';
    await tableRepository.save(table);
  }

  private duration(booking: Booking) {
    const value = Number(booking.durationMinutes);
    if (Number.isFinite(value) && value >= 30) return Math.min(720, Math.max(30, Math.round(value)));
    return DEFAULT_DURATION_MINUTES;
  }

  private timeToMinutes(value: string) {
    const [hours, minutes] = String(value || '').split(':').map(Number);
    if (!Number.isInteger(hours) || !Number.isInteger(minutes)) throw new BadRequestException('Невірний час бронювання');
    return hours * 60 + minutes;
  }

  private timeLabel(value: string) {
    const [hours = '00', minutes = '00'] = String(value || '').split(':');
    return `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}`;
  }

  private kyivDate() {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Kyiv',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
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
}
