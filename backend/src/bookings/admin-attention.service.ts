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

import type { AuthUser } from '../auth/types/auth-user.type';
import { TableEntity } from '../tables/entities/table.entity';
import { AdminBookingEventsService } from './admin-booking-events.service';
import { BookingRescheduleApprovalService } from './booking-reschedule-approval.service';
import { BookingsService } from './bookings.service';
import { GuestChangeTableDto } from './dto/guest-change-table.dto';
import { AvailabilityBlock } from './entities/availability-block.entity';
import { BookingHistory } from './entities/booking-history.entity';
import {
  BookingTableChangeRequest,
  BookingTableChangeRequestStatus,
} from './entities/booking-table-change-request.entity';
import { BookingRescheduleRequest } from './entities/booking-reschedule-request.entity';
import { Booking, BookingStatus } from './entities/booking.entity';
import { GuestAdminCall, GuestAdminCallStatus } from './entities/guest-admin-call.entity';
import { GuestReview } from './entities/guest-review.entity';

const ACTIVE_BOOKING_STATUSES: BookingStatus[] = ['pending', 'approved'];
const ACTIVE_ADMIN_CALL_STATUSES: GuestAdminCallStatus[] = ['new', 'accepted'];
const DEFAULT_DURATION_MINUTES = 120;
const CLEANUP_MINUTES = 15;

@Injectable()
export class AdminAttentionService {
  constructor(
    @InjectRepository(Booking)
    private readonly bookings: Repository<Booking>,
    @InjectRepository(BookingHistory)
    private readonly histories: Repository<BookingHistory>,
    @InjectRepository(BookingRescheduleRequest)
    private readonly reschedules: Repository<BookingRescheduleRequest>,
    @InjectRepository(BookingTableChangeRequest)
    private readonly tableChanges: Repository<BookingTableChangeRequest>,
    @InjectRepository(GuestReview)
    private readonly reviews: Repository<GuestReview>,
    @InjectRepository(GuestAdminCall)
    private readonly adminCalls: Repository<GuestAdminCall>,
    private readonly dataSource: DataSource,
    private readonly bookingEvents: AdminBookingEventsService,
    private readonly rescheduleApproval: BookingRescheduleApprovalService,
    private readonly bookingsService: BookingsService,
  ) {}

  async feed(limit?: number) {
    const take = Math.min(300, Math.max(1, Number(limit) || 120));
    const [bookingEvents, reschedules, tableChanges, reviews, adminCalls] =
      await Promise.all([
        this.bookingEvents.findRecent(take),
        this.reschedules.find({
          where: { status: 'pending' },
          relations: ['booking', 'booking.table', 'booking.table.zone', 'booking.client'],
          order: { createdAt: 'DESC' },
          take,
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
          take,
        }),
        this.reviews.find({
          relations: ['booking', 'booking.table', 'booking.table.zone', 'booking.client'],
          order: { createdAt: 'DESC' },
          take,
        }),
        this.adminCalls.find({
          where: { status: In(ACTIVE_ADMIN_CALL_STATUSES) },
          relations: ['booking', 'booking.table', 'booking.table.zone', 'booking.client'],
          order: { createdAt: 'ASC' },
          take,
        }),
      ]);

    return {
      bookingEvents,
      reschedules,
      tableChanges,
      reviews,
      adminCalls,
    };
  }

  async requestTableChange(
    bookingId: string,
    token: string,
    dto: GuestChangeTableDto,
  ) {
    try {
      await this.dataSource.transaction(async (manager) => {
        const booking = await this.findOwnedBooking(
          bookingId,
          token,
          manager,
          true,
        );
        this.assertGuestCanRequestChange(booking);

        const requestedTableNumber = await this.resolveRequestedTableNumber(
          manager,
          dto,
        );
        if (
          requestedTableNumber &&
          String(booking.table?.tableNumber || '') === requestedTableNumber
        ) {
          throw new BadRequestException('Це вже ваш поточний стіл');
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

        if (request) {
          request.requestedTableNumber = requestedTableNumber;
          request.selectedTable = null;
          request.adminComment = null;
          request.resolvedAt = null;
        } else {
          request = repository.create({
            booking,
            requestedTableNumber,
            selectedTable: null,
            status: 'pending',
            adminComment: null,
            resolvedAt: null,
          });
        }
        await repository.save(request);

        await this.saveHistory(manager, booking, 'guest_requested_table_change', {
          newData: { requestedTableNumber },
          reason: requestedTableNumber
            ? `Бажаний стіл №${requestedTableNumber}`
            : 'Гість просить підібрати інший стіл',
        });
      });
    } catch (error: any) {
      if (error?.code === '23505') {
        throw new ConflictException('Запит на зміну столу вже надіслано');
      }
      throw error;
    }

    return { message: 'Запит на зміну столу надіслано Адміністратору' };
  }

  async approveTableChange(
    requestId: string,
    tableId: string,
    actor?: AuthUser,
  ) {
    const selectedTableId = String(tableId || '').trim();
    if (!selectedTableId) throw new BadRequestException('Оберіть новий стіл');

    return this.dataSource.transaction(async (manager) => {
      const requestRepository = manager.getRepository(BookingTableChangeRequest);
      const request = await requestRepository.findOne({
        where: { id: requestId },
        relations: ['booking', 'booking.table'],
        lock: { mode: 'pessimistic_write' },
      });
      if (!request) throw new NotFoundException('Запит на зміну столу не знайдено');
      if (request.status !== 'pending') {
        throw new BadRequestException('Цей запит уже опрацьовано');
      }

      const bookingRepository = manager.getRepository(Booking);
      const booking = await bookingRepository.findOne({
        where: { id: request.booking.id },
        relations: ['table', 'client'],
        lock: { mode: 'pessimistic_write' },
      });
      if (!booking) throw new NotFoundException('Бронювання не знайдено');
      if (!ACTIVE_BOOKING_STATUSES.includes(booking.status) || booking.checkedInAt) {
        throw new BadRequestException('Зміна столу для цієї броні вже недоступна');
      }
      if (!booking.table) throw new BadRequestException('Поточний стіл не знайдено');

      const tableRepository = manager.getRepository(TableEntity);
      const nextTable = await tableRepository.findOne({
        where: { id: selectedTableId },
        relations: ['zone'],
        lock: { mode: 'pessimistic_write' },
      });
      if (!nextTable) throw new NotFoundException('Новий стіл не знайдено');
      if (nextTable.id === booking.table.id) {
        throw new BadRequestException('Оберіть інший стіл');
      }
      this.assertTableCanReceiveBooking(nextTable, booking);
      await this.assertNoTableConflict(manager, booking, nextTable);
      await this.assertNoAvailabilityBlock(manager, booking, nextTable);

      const previousTableId = booking.table.id;
      const previousTableNumber = booking.table.tableNumber;
      const previousData = this.bookingSnapshot(booking);

      booking.table = nextTable;
      booking.guestNotification = {
        type: 'booking_updated',
        title: 'Новий стіл підтверджено',
        message: `Ваше бронювання перенесено зі столу №${previousTableNumber} на стіл №${nextTable.tableNumber}.`,
        previousTableNumber,
        newTableNumber: nextTable.tableNumber,
        createdAt: new Date().toISOString(),
      };
      await bookingRepository.save(booking);

      request.status = 'approved';
      request.selectedTable = nextTable;
      request.resolvedAt = new Date();
      await requestRepository.save(request);

      await this.saveHistory(manager, booking, 'admin_approved_table_change', {
        actor,
        previousData,
        newData: this.bookingSnapshot(booking),
        reason: `Стіл №${previousTableNumber} → №${nextTable.tableNumber}`,
      });

      await this.synchronizeTableForToday(
        manager,
        previousTableId,
        booking.bookingDate,
      );
      await this.synchronizeTableForToday(
        manager,
        nextTable.id,
        booking.bookingDate,
      );

      return { message: 'Пересадку підтверджено' };
    });
  }

  async rejectTableChange(
    requestId: string,
    adminComment?: string,
    actor?: AuthUser,
  ) {
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(BookingTableChangeRequest);
      const request = await repository.findOne({
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
      await repository.save(request);

      const booking = request.booking;
      booking.guestNotification = {
        type: 'booking_updated',
        title: 'Змінити стіл зараз неможливо',
        message:
          request.adminComment ||
          'Адміністратор не зміг підібрати інший стіл для цього бронювання.',
        createdAt: new Date().toISOString(),
      };
      await manager.getRepository(Booking).save(booking);

      await this.saveHistory(manager, booking, 'admin_rejected_table_change', {
        actor,
        newData: { requestStatus: request.status },
        reason: request.adminComment,
      });

      return { message: 'Запит на зміну столу відхилено' };
    });
  }

  async approveReschedule(requestId: string, actor?: AuthUser) {
    const preview = await this.reschedules.findOne({
      where: { id: requestId },
      relations: ['booking', 'booking.table', 'booking.client'],
    });
    if (!preview) throw new NotFoundException('Запит не знайдено');
    const previousData = this.bookingSnapshot(preview.booking);

    await this.rescheduleApproval.approve(requestId);

    const request = await this.reschedules.findOne({
      where: { id: requestId },
      relations: ['booking', 'booking.table', 'booking.client'],
    });
    if (!request) throw new NotFoundException('Запит не знайдено');

    request.booking.guestNotification = {
      type: 'booking_updated',
      title: 'Новий час підтверджено',
      message: `Бронювання перенесено на ${request.requestedDate} о ${this.timeLabel(request.requestedTime)}.`,
      createdAt: new Date().toISOString(),
    };
    await this.bookings.save(request.booking);
    await this.histories.save(
      this.histories.create({
        booking: request.booking,
        action: 'admin_approved_time_change',
        actorRole: actor?.role || 'admin',
        actorStaffId: actor?.staffId || null,
        actorName: actor?.name || null,
        previousData,
        newData: this.bookingSnapshot(request.booking),
        reason: `Новий час: ${request.requestedDate} ${this.timeLabel(request.requestedTime)}`,
        isManualMode: true,
      }),
    );

    return { message: 'Новий час підтверджено' };
  }

  async rejectReschedule(
    requestId: string,
    adminComment?: string,
    actor?: AuthUser,
  ) {
    const request = await this.reschedules.findOne({
      where: { id: requestId },
      relations: ['booking', 'booking.table', 'booking.client'],
    });
    if (!request) throw new NotFoundException('Запит не знайдено');
    if (request.status !== 'pending') {
      throw new BadRequestException('Цей запит уже опрацьовано');
    }

    const comment = String(adminComment || '').trim();
    await this.bookingsService.rejectReschedule(requestId, {
      adminComment: comment || undefined,
    });

    request.booking.guestNotification = {
      type: 'booking_updated',
      title: 'Змінити час зараз неможливо',
      message:
        comment ||
        'Адміністратор не зміг підтвердити запитаний час. Бронювання залишилося без змін.',
      createdAt: new Date().toISOString(),
    };
    await this.bookings.save(request.booking);
    await this.histories.save(
      this.histories.create({
        booking: request.booking,
        action: 'admin_rejected_time_change',
        actorRole: actor?.role || 'admin',
        actorStaffId: actor?.staffId || null,
        actorName: actor?.name || null,
        previousData: null,
        newData: { requestStatus: 'rejected' },
        reason: comment || null,
        isManualMode: true,
      }),
    );

    return { message: 'Запит на зміну часу відхилено' };
  }

  async guestAdminCallStatus(bookingId: string) {
    const booking = await this.bookings.findOne({
      where: { id: bookingId },
      relations: ['table', 'client'],
    });
    if (!booking) throw new NotFoundException('Бронювання не знайдено');

    const activeCall = await this.adminCalls.findOne({
      where: {
        booking: { id: booking.id },
        status: In(ACTIVE_ADMIN_CALL_STATUSES),
      } as any,
      relations: ['booking'],
      order: { createdAt: 'DESC' },
    });

    return {
      bookingId: booking.id,
      tableNumber: booking.table?.tableNumber || null,
      bookingStatus: booking.status,
      canCall: Boolean(
        booking.status === 'approved' && booking.checkedInAt && booking.table,
      ),
      activeCall: activeCall ? this.adminCallPayload(activeCall, booking) : null,
    };
  }

  async createGuestAdminCall(bookingId: string) {
    return this.dataSource.transaction(async (manager) => {
      const booking = await manager.getRepository(Booking).findOne({
        where: { id: bookingId },
        relations: ['table', 'client'],
        lock: { mode: 'pessimistic_write' },
      });
      if (!booking) throw new NotFoundException('Бронювання не знайдено');
      if (booking.status !== 'approved' || !booking.checkedInAt || !booking.table) {
        throw new BadRequestException(
          'Виклик Адміністратора доступний після позначки «Гість прийшов»',
        );
      }

      const repository = manager.getRepository(GuestAdminCall);
      const existing = await repository.findOne({
        where: {
          booking: { id: booking.id },
          status: In(ACTIVE_ADMIN_CALL_STATUSES),
        } as any,
        relations: ['booking'],
        lock: { mode: 'pessimistic_write' },
      });
      if (existing) {
        return {
          message: 'Виклик Адміністратора вже активний',
          call: this.adminCallPayload(existing, booking),
        };
      }

      const call = await repository.save(
        repository.create({
          booking,
          status: 'new',
          acceptedAt: null,
          completedAt: null,
        }),
      );
      await this.saveHistory(manager, booking, 'guest_called_admin', {
        newData: { callId: call.id, status: call.status },
        reason: `Стіл №${booking.table.tableNumber}`,
      });

      return {
        message: 'Виклик Адміністратора відправлено',
        call: this.adminCallPayload(call, booking),
      };
    });
  }

  async acceptAdminCall(callId: string, actor?: AuthUser) {
    return this.updateAdminCall(callId, 'accepted', actor);
  }

  async completeAdminCall(callId: string, actor?: AuthUser) {
    return this.updateAdminCall(callId, 'completed', actor);
  }

  private async updateAdminCall(
    callId: string,
    nextStatus: Exclude<GuestAdminCallStatus, 'new'>,
    actor?: AuthUser,
  ) {
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(GuestAdminCall);
      const call = await repository.findOne({
        where: { id: callId },
        relations: ['booking', 'booking.table', 'booking.client'],
        lock: { mode: 'pessimistic_write' },
      });
      if (!call) throw new NotFoundException('Виклик Адміністратора не знайдено');

      if (nextStatus === 'accepted') {
        if (call.status !== 'new') {
          throw new BadRequestException('Цей виклик уже прийнято або завершено');
        }
        call.status = 'accepted';
        call.acceptedAt = new Date();
      } else {
        if (call.status !== 'accepted') {
          throw new BadRequestException('Спочатку прийміть виклик');
        }
        call.status = 'completed';
        call.completedAt = new Date();
      }
      await repository.save(call);

      await this.saveHistory(
        manager,
        call.booking,
        nextStatus === 'accepted'
          ? 'admin_accepted_guest_call'
          : 'admin_completed_guest_call',
        {
          actor,
          newData: { callId: call.id, status: call.status },
          reason: `Стіл №${call.booking.table?.tableNumber || '-'}`,
        },
      );

      return {
        message:
          nextStatus === 'accepted'
            ? 'Виклик прийнято'
            : 'Виклик завершено',
        call: this.adminCallPayload(call, call.booking),
      };
    });
  }

  private async findOwnedBooking(
    id: string,
    token: string,
    manager: EntityManager,
    lock = false,
  ) {
    const normalizedToken = String(token || '').trim();
    if (!normalizedToken || normalizedToken.length > 256) {
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
        hash: createHash('sha256').update(normalizedToken).digest('hex'),
      });

    if (lock) query = query.setLock('pessimistic_write', undefined, ['booking']);
    const booking = await query.getOne();
    if (!booking) throw new UnauthorizedException('Недійсний доступ до бронювання');
    return booking;
  }

  private assertGuestCanRequestChange(booking: Booking) {
    if (!ACTIVE_BOOKING_STATUSES.includes(booking.status) || booking.checkedInAt) {
      throw new BadRequestException('Зміна столу для цієї броні вже недоступна');
    }
  }

  private async resolveRequestedTableNumber(
    manager: EntityManager,
    dto: GuestChangeTableDto,
  ) {
    const tableNumber = String(dto.tableNumber || '').trim();
    const tableId = String(dto.tableId || '').trim();
    if (!tableNumber && !tableId) return null;
    if (tableNumber) return tableNumber;

    const table = await manager.getRepository(TableEntity).findOne({
      where: { id: tableId },
    });
    if (!table) throw new BadRequestException('Стіл не знайдено');
    return String(table.tableNumber);
  }

  private assertTableCanReceiveBooking(table: TableEntity, booking: Booking) {
    if (!table.isVisible || table.status === 'closed') {
      throw new BadRequestException('Цей стіл зараз недоступний');
    }
    if (table.zone?.isClosed || table.zone?.isVisible === false) {
      throw new BadRequestException('Ця локація зараз закрита');
    }
    if (Number(table.seats) < Number(booking.guestsCount)) {
      throw new BadRequestException('Обраний стіл не вміщує всіх гостей');
    }
    if (
      booking.bookingDate === this.kyivDate() &&
      ['occupied', 'cleaning'].includes(table.status)
    ) {
      throw new BadRequestException('Обраний стіл зараз зайнятий або готується');
    }
  }

  private async assertNoTableConflict(
    manager: EntityManager,
    booking: Booking,
    table: TableEntity,
  ) {
    const candidates = await manager
      .getRepository(Booking)
      .createQueryBuilder('candidate')
      .where('candidate.table_id = :tableId', { tableId: table.id })
      .andWhere('candidate.bookingDate = :bookingDate', {
        bookingDate: booking.bookingDate,
      })
      .andWhere('candidate.status IN (:...statuses)', {
        statuses: ACTIVE_BOOKING_STATUSES,
      })
      .andWhere('candidate.id != :bookingId', { bookingId: booking.id })
      .getMany();

    const start = this.timeToMinutes(booking.bookingTime);
    const end = start + this.duration(booking) + CLEANUP_MINUTES;
    const conflict = candidates.find((candidate) => {
      const candidateStart = this.timeToMinutes(candidate.bookingTime);
      const candidateEnd =
        candidateStart + this.duration(candidate) + CLEANUP_MINUTES;
      return start < candidateEnd && end > candidateStart;
    });

    if (conflict) {
      throw new ConflictException('Цей стіл має конфлікт у часі бронювання');
    }
  }

  private async assertNoAvailabilityBlock(
    manager: EntityManager,
    booking: Booking,
    table: TableEntity,
  ) {
    const blocks = await manager.getRepository(AvailabilityBlock).find({
      where: { blockDate: booking.bookingDate },
      relations: ['table', 'zone'],
    });
    const start = this.timeToMinutes(booking.bookingTime);
    const end = start + this.duration(booking) + CLEANUP_MINUTES;

    const conflict = blocks.find((block) => {
      const appliesToTable = block.table?.id === table.id;
      const appliesToZone = Boolean(
        block.zone?.id && table.zone?.id && block.zone.id === table.zone.id,
      );
      if (!appliesToTable && !appliesToZone) return false;
      if (!block.startTime || !block.endTime) return true;
      return (
        start < this.timeToMinutes(block.endTime) &&
        end > this.timeToMinutes(block.startTime)
      );
    });

    if (conflict) {
      throw new BadRequestException(
        conflict.reason
          ? `Стіл недоступний: ${conflict.reason}`
          : 'Стіл недоступний на цей час',
      );
    }
  }

  private async synchronizeTableForToday(
    manager: EntityManager,
    tableId: string,
    bookingDate: string,
  ) {
    if (bookingDate !== this.kyivDate()) return;

    const repository = manager.getRepository(TableEntity);
    const table = await repository.findOne({
      where: { id: tableId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!table || ['closed', 'occupied', 'cleaning'].includes(table.status)) return;

    const activeBookings = await manager.getRepository(Booking).find({
      where: {
        table: { id: tableId },
        bookingDate,
        status: In(ACTIVE_BOOKING_STATUSES),
      } as any,
      relations: ['table'],
    });

    table.status = activeBookings.some((item) => item.status === 'approved')
      ? 'reserved'
      : activeBookings.some((item) => item.status === 'pending')
        ? 'pending'
        : 'free';
    await repository.save(table);
  }

  private async saveHistory(
    manager: EntityManager,
    booking: Booking,
    action: string,
    options: {
      actor?: AuthUser;
      previousData?: Record<string, unknown> | null;
      newData?: Record<string, unknown> | null;
      reason?: string | null;
    },
  ) {
    const actor = options.actor;
    const repository = manager.getRepository(BookingHistory);
    await repository.save(
      repository.create({
        booking,
        action,
        actorRole: actor?.role || (action.startsWith('guest_') ? 'guest' : 'admin'),
        actorStaffId: actor?.staffId || null,
        actorName: actor?.name || null,
        previousData: options.previousData || null,
        newData: options.newData || null,
        reason: options.reason || null,
        isManualMode: !action.startsWith('guest_'),
      }),
    );
  }

  private bookingSnapshot(booking: Booking): Record<string, unknown> {
    return {
      status: booking.status,
      bookingDate: booking.bookingDate,
      bookingTime: booking.bookingTime,
      tableId: booking.table?.id || null,
      tableNumber: booking.table?.tableNumber || null,
      guestsCount: booking.guestsCount,
      checkedInAt: booking.checkedInAt || null,
    };
  }

  private adminCallPayload(call: GuestAdminCall, booking: Booking) {
    return {
      id: call.id,
      status: call.status,
      createdAt: call.createdAt,
      acceptedAt: call.acceptedAt,
      completedAt: call.completedAt,
      bookingId: booking.id,
      tableNumber: booking.table?.tableNumber || null,
      clientName: booking.client?.fullName || null,
    };
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
    const duration = end >= start ? end - start : end + 1440 - start;
    return Math.min(720, Math.max(30, duration));
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
