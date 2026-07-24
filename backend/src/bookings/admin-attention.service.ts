import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';

import { TableEntity } from '../tables/entities/table.entity';
import { BookingRescheduleApprovalService } from './booking-reschedule-approval.service';
import { BookingsService } from './bookings.service';
import { AdminCall } from './entities/admin-call.entity';
import { AvailabilityBlock } from './entities/availability-block.entity';
import { BookingHistory } from './entities/booking-history.entity';
import { BookingRescheduleRequest } from './entities/booking-reschedule-request.entity';
import { BookingTableChangeRequest } from './entities/booking-table-change-request.entity';
import { Booking, BookingStatus } from './entities/booking.entity';
import { GuestReview } from './entities/guest-review.entity';

const ACTIVE_STATUSES: BookingStatus[] = ['pending', 'approved'];
const LEGACY_ACTIONS = [
  'booking_created',
  'guest_cancelled',
  'guest_reported_lateness',
  'guest_changed_table',
];
const CLEANUP_MINUTES = 15;
const DEFAULT_DURATION_MINUTES = 120;

@Injectable()
export class AdminAttentionService {
  constructor(
    @InjectRepository(BookingHistory)
    private readonly histories: Repository<BookingHistory>,
    @InjectRepository(BookingRescheduleRequest)
    private readonly reschedules: Repository<BookingRescheduleRequest>,
    @InjectRepository(BookingTableChangeRequest)
    private readonly tableChanges: Repository<BookingTableChangeRequest>,
    @InjectRepository(AdminCall)
    private readonly calls: Repository<AdminCall>,
    @InjectRepository(GuestReview)
    private readonly reviews: Repository<GuestReview>,
    private readonly dataSource: DataSource,
    private readonly rescheduleApproval: BookingRescheduleApprovalService,
    private readonly bookingsService: BookingsService,
  ) {}

  async list(limit?: number) {
    const take = Math.min(300, Math.max(1, Number(limit) || 150));
    const relations = ['booking', 'booking.table', 'booking.table.zone', 'booking.client'];
    const [histories, reschedules, tableChanges, calls, reviews] = await Promise.all([
      this.histories.find({
        where: { action: In(LEGACY_ACTIONS) },
        relations,
        order: { createdAt: 'DESC' },
        take,
      }),
      this.reschedules.find({
        where: { status: 'pending' },
        relations,
        order: { createdAt: 'ASC' },
        take,
      }),
      this.tableChanges.find({
        where: { status: 'pending' },
        relations,
        order: { createdAt: 'ASC' },
        take,
      }),
      this.calls.find({
        where: { status: In(['new', 'accepted']) },
        relations,
        order: { createdAt: 'ASC' },
        take,
      }),
      this.reviews.find({
        relations,
        order: { createdAt: 'DESC' },
        take,
      }),
    ]);

    const reviewItems = reviews.map((review) => ({
      id: `review:${review.id}`,
      sourceId: review.id,
      kind: 'review',
      createdAt: review.createdAt,
      text: review.text,
      isPublished: review.isPublished,
      booking: review.booking,
    }));

    const items: Array<Record<string, any>> = [
      ...calls.map((call) => ({
        id: `admin-call:${call.id}`,
        sourceId: call.id,
        kind: 'admin_call',
        createdAt: call.createdAt,
        status: call.status,
        acceptedAt: call.acceptedAt,
        booking: call.booking,
      })),
      ...tableChanges.map((request) => ({
        id: `table-change:${request.id}`,
        sourceId: request.id,
        kind: 'table_change_request',
        createdAt: request.createdAt,
        requestedTableNumber: request.requestedTableNumber,
        booking: request.booking,
      })),
      ...reschedules.map((request) => ({
        id: `reschedule:${request.id}`,
        sourceId: request.id,
        kind: 'reschedule_request',
        createdAt: request.createdAt,
        requestedDate: request.requestedDate,
        requestedTime: request.requestedTime,
        booking: request.booking,
      })),
      ...histories.map((history) => ({
        id: `history:${history.id}`,
        sourceId: history.id,
        kind: 'booking_event',
        action: history.action,
        createdAt: history.createdAt,
        reason: history.reason,
        previousData: history.previousData,
        newData: history.newData,
        booking: history.booking,
      })),
      ...reviewItems,
    ];

    const priority: Record<string, number> = {
      admin_call: 1,
      table_change_request: 2,
      reschedule_request: 3,
      booking_event: 4,
      review: 5,
    };
    items.sort((left, right) => {
      const order = priority[left.kind] - priority[right.kind];
      if (order !== 0) return order;
      return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
    });

    return { items, reviews: reviewItems };
  }

  async tableOptions(requestId: string) {
    const request = await this.tableChanges.findOne({
      where: { id: requestId },
      relations: ['booking', 'booking.table', 'booking.client'],
    });
    this.assertPendingTableRequest(request);

    const manager = this.dataSource.manager;
    const [tables, activeBookings, blocks] = await Promise.all([
      manager.getRepository(TableEntity).find({ relations: ['zone'] }),
      manager.getRepository(Booking).find({
        where: {
          bookingDate: request!.booking.bookingDate,
          status: In(ACTIVE_STATUSES),
        } as any,
        relations: ['table'],
      }),
      manager.getRepository(AvailabilityBlock).find({
        where: { blockDate: request!.booking.bookingDate },
        relations: ['table', 'zone'],
      }),
    ]);

    return tables
      .filter((table) => this.isCandidate(table, request!.booking))
      .filter((table) => this.isSlotFree(table, request!.booking, activeBookings, blocks))
      .sort((left, right) => Number(left.tableNumber) - Number(right.tableNumber))
      .map((table) => ({
        id: table.id,
        tableNumber: table.tableNumber,
        seats: table.seats,
        zoneName: table.zone?.name || 'Без локації',
      }));
  }

  async approveTableChange(requestId: string, tableId: string) {
    if (!tableId) throw new BadRequestException('Оберіть новий стіл');

    return this.dataSource.transaction(async (manager) => {
      const requestRepository = manager.getRepository(BookingTableChangeRequest);
      const request = await requestRepository.findOne({
        where: { id: requestId },
        relations: ['booking'],
        lock: { mode: 'pessimistic_write' },
      });
      this.assertPendingTableRequest(request);

      const bookingRepository = manager.getRepository(Booking);
      const booking = await bookingRepository.findOne({
        where: { id: request!.booking.id },
        relations: ['table', 'table.zone', 'client'],
        lock: { mode: 'pessimistic_write' },
      });
      if (!booking) throw new NotFoundException('Бронювання не знайдено');
      if (!ACTIVE_STATUSES.includes(booking.status) || booking.checkedInAt) {
        throw new BadRequestException('Зміна столу для цієї броні вже недоступна');
      }

      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtext($1::text), hashtext($2::text))',
        [tableId, booking.bookingDate],
      );

      const tableRepository = manager.getRepository(TableEntity);
      const nextTable = await tableRepository.findOne({
        where: { id: tableId },
        relations: ['zone'],
        lock: { mode: 'pessimistic_write' },
      });
      if (!nextTable) throw new NotFoundException('Стіл не знайдено');
      if (!this.isCandidate(nextTable, booking)) {
        throw new BadRequestException('Обраний стіл закритий, замалий або недоступний');
      }

      const [activeBookings, blocks] = await Promise.all([
        bookingRepository.find({
          where: {
            bookingDate: booking.bookingDate,
            status: In(ACTIVE_STATUSES),
          } as any,
          relations: ['table'],
        }),
        manager.getRepository(AvailabilityBlock).find({
          where: { blockDate: booking.bookingDate },
          relations: ['table', 'zone'],
        }),
      ]);
      if (!this.isSlotFree(nextTable, booking, activeBookings, blocks)) {
        throw new BadRequestException('Обраний стіл має конфлікт у цей час');
      }

      const oldTable = booking.table;
      const oldNumber = oldTable?.tableNumber || null;
      booking.table = nextTable;
      booking.guestNotification = {
        type: 'booking_updated',
        title: 'Зміну столу підтверджено',
        message: `Ваш новий стіл — №${nextTable.tableNumber}`,
        previousTableNumber: oldNumber,
        newTableNumber: nextTable.tableNumber,
        createdAt: new Date().toISOString(),
      };
      await bookingRepository.save(booking);

      request!.status = 'approved';
      request!.resolvedAt = new Date();
      request!.adminComment = null;
      await requestRepository.save(request!);

      await this.saveHistory(manager, booking, 'guest_table_change_approved', {
        previousData: { tableId: oldTable?.id || null, tableNumber: oldNumber },
        newData: { tableId: nextTable.id, tableNumber: nextTable.tableNumber },
        reason: `Стіл №${oldNumber || '-'} → №${nextTable.tableNumber}`,
      });

      if (booking.bookingDate === this.kyivDate()) {
        if (oldTable?.id) await this.synchronizeTable(manager, oldTable.id, booking.bookingDate);
        if (!['closed', 'occupied', 'cleaning'].includes(nextTable.status)) {
          nextTable.status = booking.status === 'approved' ? 'reserved' : 'pending';
          await tableRepository.save(nextTable);
        }
      }

      return { message: `Бронювання перенесено на стіл №${nextTable.tableNumber}` };
    });
  }

  async rejectTableChange(requestId: string, adminComment?: string) {
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(BookingTableChangeRequest);
      const request = await repository.findOne({
        where: { id: requestId },
        relations: ['booking', 'booking.table', 'booking.client'],
        lock: { mode: 'pessimistic_write' },
      });
      this.assertPendingTableRequest(request);

      request!.status = 'rejected';
      request!.adminComment = String(adminComment || '').trim() || null;
      request!.resolvedAt = new Date();
      await repository.save(request!);

      request!.booking.guestNotification = {
        type: 'booking_updated',
        title: 'Зміну столу не підтверджено',
        message: request!.adminComment || 'На жаль, зараз немає відповідного вільного столу.',
        createdAt: new Date().toISOString(),
      };
      await manager.getRepository(Booking).save(request!.booking);
      await this.saveHistory(manager, request!.booking, 'guest_table_change_rejected', {
        newData: { requestId, adminComment: request!.adminComment },
        reason: request!.adminComment,
      });
      return { message: 'Запит на зміну столу відхилено' };
    });
  }

  async approveReschedule(requestId: string) {
    const before = await this.reschedules.findOne({
      where: { id: requestId },
      relations: ['booking'],
    });
    if (!before) throw new NotFoundException('Запит на зміну часу не знайдено');
    const previousData = {
      bookingDate: before.booking.bookingDate,
      bookingTime: before.booking.bookingTime,
    };

    const result = await this.rescheduleApproval.approve(requestId);
    await this.dataSource.transaction(async (manager) => {
      const request = await manager.getRepository(BookingRescheduleRequest).findOne({
        where: { id: requestId },
        relations: ['booking', 'booking.table', 'booking.client'],
      });
      if (!request) return;
      request.booking.guestNotification = {
        type: 'booking_updated',
        title: 'Зміну часу підтверджено',
        message: `Новий час: ${request.requestedDate} · ${this.timeLabel(request.requestedTime)}`,
        createdAt: new Date().toISOString(),
      };
      await manager.getRepository(Booking).save(request.booking);
      await this.saveHistory(manager, request.booking, 'guest_time_change_approved', {
        previousData,
        newData: {
          bookingDate: request.requestedDate,
          bookingTime: request.requestedTime,
        },
      });
    });
    return result;
  }

  async rejectReschedule(requestId: string, adminComment?: string) {
    const request = await this.reschedules.findOne({
      where: { id: requestId },
      relations: ['booking'],
    });
    if (!request) throw new NotFoundException('Запит на зміну часу не знайдено');
    const comment = String(adminComment || '').trim();
    const result = await this.bookingsService.rejectReschedule(requestId, {
      adminComment: comment || undefined,
    });

    await this.dataSource.transaction(async (manager) => {
      const booking = await manager.getRepository(Booking).findOne({
        where: { id: request.booking.id },
        relations: ['table', 'client'],
        lock: { mode: 'pessimistic_write' },
      });
      if (!booking) return;
      booking.guestNotification = {
        type: 'booking_updated',
        title: 'Зміну часу не підтверджено',
        message: comment || 'На жаль, запропонований час недоступний.',
        createdAt: new Date().toISOString(),
      };
      await manager.getRepository(Booking).save(booking);
      await this.saveHistory(manager, booking, 'guest_time_change_rejected', {
        newData: { requestId, adminComment: comment || null },
      });
    });
    return result;
  }

  async acceptAdminCall(callId: string) {
    return this.updateCall(callId, 'accepted');
  }

  async completeAdminCall(callId: string) {
    return this.updateCall(callId, 'completed');
  }

  private async updateCall(callId: string, nextStatus: 'accepted' | 'completed') {
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(AdminCall);
      const call = await repository.findOne({
        where: { id: callId },
        relations: ['booking', 'booking.table', 'booking.client'],
        lock: { mode: 'pessimistic_write' },
      });
      if (!call) throw new NotFoundException('Виклик Адміністратора не знайдено');
      if (call.status === 'completed') return { message: 'Виклик уже завершено' };
      if (call.status === nextStatus) return { message: 'Виклик уже прийнято' };

      const previousStatus = call.status;
      call.status = nextStatus;
      if (!call.acceptedAt) call.acceptedAt = new Date();
      if (nextStatus === 'completed') call.completedAt = new Date();
      await repository.save(call);
      await this.saveHistory(manager, call.booking, `admin_call_${nextStatus}`, {
        previousData: { status: previousStatus },
        newData: { status: nextStatus },
      });
      return {
        message: nextStatus === 'accepted'
          ? 'Виклик Адміністратора прийнято'
          : 'Виклик Адміністратора завершено',
      };
    });
  }

  private assertPendingTableRequest(request: BookingTableChangeRequest | null) {
    if (!request) throw new NotFoundException('Запит на зміну столу не знайдено');
    if (request.status !== 'pending') throw new BadRequestException('Цей запит уже опрацьовано');
  }

  private isCandidate(table: TableEntity, booking: Booking) {
    return Boolean(
      table.id !== booking.table?.id &&
      table.isVisible &&
      table.status !== 'closed' &&
      table.zone?.isVisible !== false &&
      !table.zone?.isClosed &&
      Number(table.seats) >= Number(booking.guestsCount),
    );
  }

  private isSlotFree(
    table: TableEntity,
    booking: Booking,
    activeBookings: Booking[],
    blocks: AvailabilityBlock[],
  ) {
    const start = this.timeToMinutes(booking.bookingTime);
    const end = start + this.duration(booking) + CLEANUP_MINUTES;
    const bookingConflict = activeBookings.some((candidate) => {
      if (candidate.id === booking.id || candidate.table?.id !== table.id) return false;
      const candidateStart = this.timeToMinutes(candidate.bookingTime);
      const candidateEnd = candidateStart + this.duration(candidate) + CLEANUP_MINUTES;
      return start < candidateEnd && end > candidateStart;
    });
    if (bookingConflict) return false;

    return !blocks.some((block) => {
      const applies = block.table?.id === table.id || Boolean(
        block.zone?.id && table.zone?.id && block.zone.id === table.zone.id,
      );
      if (!applies) return false;
      if (!block.startTime || !block.endTime) return true;
      return start < this.timeToMinutes(block.endTime) && end > this.timeToMinutes(block.startTime);
    });
  }

  private async synchronizeTable(manager: EntityManager, tableId: string, bookingDate: string) {
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
        status: In(ACTIVE_STATUSES),
      } as any,
      relations: ['table'],
    });
    table.status = active.some((item) => item.status === 'approved')
      ? 'reserved'
      : active.some((item) => item.status === 'pending')
        ? 'pending'
        : 'free';
    await repository.save(table);
  }

  private async saveHistory(
    manager: EntityManager,
    booking: Booking,
    action: string,
    payload: {
      previousData?: Record<string, unknown> | null;
      newData?: Record<string, unknown> | null;
      reason?: string | null;
    },
  ) {
    const repository = manager.getRepository(BookingHistory);
    await repository.save(repository.create({
      booking,
      action,
      actorRole: 'admin',
      actorStaffId: null,
      actorName: null,
      previousData: payload.previousData || null,
      newData: payload.newData || null,
      reason: payload.reason || null,
      isManualMode: true,
    }));
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
    if (!Number.isInteger(hours) || !Number.isInteger(minutes)) {
      throw new BadRequestException('Невірний формат часу');
    }
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
}
