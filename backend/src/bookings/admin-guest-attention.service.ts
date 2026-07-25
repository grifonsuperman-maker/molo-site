import { BadRequestException, ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomUUID } from 'crypto';
import { DataSource, EntityManager, In, Repository } from 'typeorm';

import { TableEntity } from '../tables/entities/table.entity';
import { AvailabilityBlock } from './entities/availability-block.entity';
import { BookingHistory } from './entities/booking-history.entity';
import { Booking, BookingStatus, GuestBookingNotification } from './entities/booking.entity';
import { GuestReview } from './entities/guest-review.entity';

const ACTIVE_BOOKING_STATUSES: BookingStatus[] = ['pending', 'approved'];
const DEFAULT_DURATION_MINUTES = 120;
const CLEANUP_MINUTES = 15;

const REQUEST_ACTIONS = [
  'guest_requested_table_change',
  'admin_approved_table_change',
  'admin_rejected_table_change',
  'guest_called_admin',
  'admin_accepted_call',
  'admin_completed_call',
] as const;

type AttentionKind = 'table_change' | 'admin_call';
type AttentionStatus = 'pending' | 'approved' | 'rejected' | 'accepted' | 'completed';

type AttentionRequest = {
  requestId: string;
  type: AttentionKind;
  status: AttentionStatus;
  createdAt: Date;
  updatedAt: Date;
  booking: Booking;
};

@Injectable()
export class AdminGuestAttentionService {
  constructor(
    @InjectRepository(Booking)
    private readonly bookings: Repository<Booking>,
    @InjectRepository(BookingHistory)
    private readonly histories: Repository<BookingHistory>,
    @InjectRepository(GuestReview)
    private readonly reviews: Repository<GuestReview>,
    @InjectRepository(TableEntity)
    private readonly tables: Repository<TableEntity>,
    @InjectRepository(AvailabilityBlock)
    private readonly availabilityBlocks: Repository<AvailabilityBlock>,
    private readonly dataSource: DataSource,
  ) {}

  async requestTableChange(bookingId: string, token: string) {
    const result = await this.dataSource.transaction(async (manager) => {
      const booking = await this.findOwnedBooking(bookingId, token, manager, true);
      this.assertGuestCanRequestTable(booking);

      const requests = await this.loadRequestsForBooking(manager, booking.id);
      const existing = requests.find(
        (request) => request.type === 'table_change' && request.status === 'pending',
      );
      if (existing) {
        return { requestId: existing.requestId, alreadyPending: true };
      }

      const requestId = randomUUID();
      await this.saveHistory(manager, booking, 'guest_requested_table_change', {
        requestId,
        requestType: 'table_change',
      }, 'Гість просить підібрати інший стіл');

      return { requestId, alreadyPending: false };
    });

    return {
      message: result.alreadyPending
        ? 'Запит на інший стіл уже очікує відповіді Адміністратора'
        : 'Запит на інший стіл надіслано Адміністратору',
      requestId: result.requestId,
    };
  }

  async callAdmin(bookingId: string, token: string) {
    const result = await this.dataSource.transaction(async (manager) => {
      const booking = await this.findOwnedBooking(bookingId, token, manager, true);
      if (booking.status !== 'approved' || !booking.checkedInAt) {
        throw new BadRequestException('Виклик Адміністратора доступний після відмітки «Гість прийшов»');
      }

      const requests = await this.loadRequestsForBooking(manager, booking.id);
      const existing = requests.find(
        (request) => request.type === 'admin_call' && ['pending', 'accepted'].includes(request.status),
      );
      if (existing) {
        return { requestId: existing.requestId, alreadyPending: true };
      }

      const requestId = randomUUID();
      await this.saveHistory(manager, booking, 'guest_called_admin', {
        requestId,
        requestType: 'admin_call',
      }, 'Гість викликав Адміністратора');

      return { requestId, alreadyPending: false };
    });

    return {
      message: result.alreadyPending
        ? 'Адміністратора вже викликано'
        : 'Виклик Адміністратора надіслано',
      requestId: result.requestId,
    };
  }

  async list() {
    const [historyRows, reviews] = await Promise.all([
      this.histories.find({
        where: { action: In([...REQUEST_ACTIONS]) },
        relations: ['booking', 'booking.table', 'booking.table.zone', 'booking.client'],
        order: { createdAt: 'DESC' },
        take: 500,
      }),
      this.reviews.find({
        relations: ['booking', 'booking.table', 'booking.table.zone', 'booking.client'],
        order: { createdAt: 'DESC' },
        take: 150,
      }),
    ]);

    const requests = this.summarizeRequests(historyRows);
    return {
      tableRequests: requests
        .filter((request) => request.type === 'table_change' && request.status === 'pending')
        .map((request) => this.requestPayload(request)),
      adminCalls: requests
        .filter((request) => request.type === 'admin_call' && ['pending', 'accepted'].includes(request.status))
        .map((request) => this.requestPayload(request)),
      reviews: reviews.map((review) => ({
        id: review.id,
        text: review.text,
        isPublished: review.isPublished,
        createdAt: review.createdAt,
        booking: review.booking,
      })),
    };
  }

  async approveTableRequest(requestId: string, tableId: string) {
    if (!tableId) throw new BadRequestException('Оберіть новий стіл');

    return this.dataSource.transaction(async (manager) => {
      const request = await this.requireActiveRequest(manager, requestId, 'table_change', ['pending']);
      const bookingRepository = manager.getRepository(Booking);
      const tableRepository = manager.getRepository(TableEntity);

      const booking = await bookingRepository.findOne({
        where: { id: request.booking.id },
        relations: ['table', 'table.zone', 'client'],
        lock: { mode: 'pessimistic_write' },
      });
      if (!booking) throw new NotFoundException('Бронювання не знайдено');
      this.assertGuestCanRequestTable(booking);

      const nextTable = await tableRepository.findOne({
        where: { id: tableId },
        relations: ['zone'],
        lock: { mode: 'pessimistic_write' },
      });
      if (!nextTable) throw new NotFoundException('Стіл не знайдено');
      if (!nextTable.isVisible || nextTable.status === 'closed' || nextTable.zone?.isClosed || nextTable.zone?.isVisible === false) {
        throw new BadRequestException('Цей стіл зараз недоступний');
      }
      if (booking.table?.id === nextTable.id) throw new BadRequestException('Оберіть інший стіл');
      if (Number(nextTable.seats) < Number(booking.guestsCount)) {
        throw new BadRequestException('Обраний стіл не вміщує всіх гостей');
      }

      await this.assertNoBlockOrBookingConflict(manager, booking, nextTable);

      const oldTable = booking.table?.id
        ? await tableRepository.findOne({
            where: { id: booking.table.id },
            lock: { mode: 'pessimistic_write' },
          })
        : null;
      const oldTableNumber = oldTable?.tableNumber || booking.table?.tableNumber || null;

      booking.table = nextTable;
      booking.guestNotification = {
        type: 'booking_updated',
        title: 'Адміністратор змінив стіл',
        message: `Стіл №${oldTableNumber || '—'} змінено на стіл №${nextTable.tableNumber}`,
        previousTableNumber: oldTableNumber,
        newTableNumber: nextTable.tableNumber,
        createdAt: new Date().toISOString(),
      } satisfies GuestBookingNotification;
      await bookingRepository.save(booking);

      if (this.isToday(booking.bookingDate)) {
        if (oldTable && !['closed', 'occupied', 'cleaning'].includes(oldTable.status)) {
          oldTable.status = 'free';
          await tableRepository.save(oldTable);
        }
        if (!['closed', 'occupied', 'cleaning'].includes(nextTable.status)) {
          nextTable.status = booking.status === 'approved' ? 'reserved' : 'pending';
          await tableRepository.save(nextTable);
        }
      }

      await this.saveHistory(manager, booking, 'admin_approved_table_change', {
        requestId,
        requestType: 'table_change',
        oldTableNumber,
        newTableNumber: nextTable.tableNumber,
      }, `Стіл №${oldTableNumber || '—'} → №${nextTable.tableNumber}`);

      return { message: `Гостя перенесено на стіл №${nextTable.tableNumber}` };
    });
  }

  async rejectTableRequest(requestId: string, comment?: string) {
    return this.dataSource.transaction(async (manager) => {
      const request = await this.requireActiveRequest(manager, requestId, 'table_change', ['pending']);
      const booking = await manager.getRepository(Booking).findOne({
        where: { id: request.booking.id },
        relations: ['table', 'client'],
        lock: { mode: 'pessimistic_write' },
      });
      if (!booking) throw new NotFoundException('Бронювання не знайдено');

      booking.guestNotification = {
        type: 'booking_updated',
        title: 'Змінити стіл зараз неможливо',
        message: String(comment || '').trim() || 'Адміністратор не знайшов відповідного вільного столу.',
        createdAt: new Date().toISOString(),
      } satisfies GuestBookingNotification;
      await manager.getRepository(Booking).save(booking);
      await this.saveHistory(manager, booking, 'admin_rejected_table_change', {
        requestId,
        requestType: 'table_change',
      }, booking.guestNotification.message || null);

      return { message: 'Запит на інший стіл відхилено' };
    });
  }

  async acceptAdminCall(requestId: string) {
    return this.resolveAdminCall(requestId, 'admin_accepted_call', ['pending'], 'Виклик прийнято');
  }

  async completeAdminCall(requestId: string) {
    return this.resolveAdminCall(requestId, 'admin_completed_call', ['pending', 'accepted'], 'Виклик завершено');
  }

  private async resolveAdminCall(
    requestId: string,
    action: 'admin_accepted_call' | 'admin_completed_call',
    allowedStatuses: AttentionStatus[],
    message: string,
  ) {
    return this.dataSource.transaction(async (manager) => {
      const request = await this.requireActiveRequest(manager, requestId, 'admin_call', allowedStatuses);
      const booking = await manager.getRepository(Booking).findOne({
        where: { id: request.booking.id },
        relations: ['table', 'client'],
        lock: { mode: 'pessimistic_write' },
      });
      if (!booking) throw new NotFoundException('Бронювання не знайдено');

      await this.saveHistory(manager, booking, action, {
        requestId,
        requestType: 'admin_call',
      }, message);
      return { message };
    });
  }

  private async requireActiveRequest(
    manager: EntityManager,
    requestId: string,
    type: AttentionKind,
    allowedStatuses: AttentionStatus[],
  ) {
    const rows = await manager.getRepository(BookingHistory).find({
      where: { action: In([...REQUEST_ACTIONS]) },
      relations: ['booking', 'booking.table', 'booking.table.zone', 'booking.client'],
      order: { createdAt: 'ASC' },
      take: 1000,
    });
    const request = this.summarizeRequests(rows).find((item) => item.requestId === requestId && item.type === type);
    if (!request) throw new NotFoundException('Запит не знайдено');
    if (!allowedStatuses.includes(request.status)) throw new ConflictException('Цей запит уже опрацьовано');
    return request;
  }

  private summarizeRequests(rows: BookingHistory[]) {
    const requests = new Map<string, AttentionRequest>();
    const ordered = [...rows].sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());

    for (const row of ordered) {
      const requestId = String(row.newData?.requestId || row.previousData?.requestId || '');
      if (!requestId) continue;

      if (row.action === 'guest_requested_table_change') {
        requests.set(requestId, {
          requestId,
          type: 'table_change',
          status: 'pending',
          createdAt: row.createdAt,
          updatedAt: row.createdAt,
          booking: row.booking,
        });
        continue;
      }
      if (row.action === 'guest_called_admin') {
        requests.set(requestId, {
          requestId,
          type: 'admin_call',
          status: 'pending',
          createdAt: row.createdAt,
          updatedAt: row.createdAt,
          booking: row.booking,
        });
        continue;
      }

      const request = requests.get(requestId);
      if (!request) continue;
      if (row.action === 'admin_approved_table_change') request.status = 'approved';
      if (row.action === 'admin_rejected_table_change') request.status = 'rejected';
      if (row.action === 'admin_accepted_call') request.status = 'accepted';
      if (row.action === 'admin_completed_call') request.status = 'completed';
      request.updatedAt = row.createdAt;
      request.booking = row.booking || request.booking;
    }

    return [...requests.values()].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
  }

  private async loadRequestsForBooking(manager: EntityManager, bookingId: string) {
    const rows = await manager.getRepository(BookingHistory).find({
      where: {
        booking: { id: bookingId },
        action: In([...REQUEST_ACTIONS]),
      } as any,
      relations: ['booking', 'booking.table', 'booking.table.zone', 'booking.client'],
      order: { createdAt: 'ASC' },
      take: 300,
    });
    return this.summarizeRequests(rows);
  }

  private requestPayload(request: AttentionRequest) {
    return {
      requestId: request.requestId,
      type: request.type,
      status: request.status,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
      booking: request.booking,
    };
  }

  private async findOwnedBooking(
    id: string,
    token: string,
    manager: EntityManager,
    lock: boolean,
  ) {
    const normalized = String(token || '').trim();
    if (!normalized || normalized.length > 256) throw new UnauthorizedException('Недійсний доступ до бронювання');
    const hash = createHash('sha256').update(normalized).digest('hex');

    let query = manager.getRepository(Booking)
      .createQueryBuilder('booking')
      .addSelect('booking.guestAccessTokenHash')
      .leftJoinAndSelect('booking.table', 'table')
      .leftJoinAndSelect('table.zone', 'zone')
      .leftJoinAndSelect('booking.client', 'client')
      .where('booking.id = :id', { id })
      .andWhere('booking.guestAccessTokenHash = :hash', { hash });
    if (lock) query = query.setLock('pessimistic_write', undefined, ['booking']);
    const booking = await query.getOne();
    if (!booking) throw new UnauthorizedException('Недійсний доступ до бронювання');
    return booking;
  }

  private assertGuestCanRequestTable(booking: Booking) {
    if (!ACTIVE_BOOKING_STATUSES.includes(booking.status) || booking.checkedInAt) {
      throw new BadRequestException('Запит на інший стіл для цієї броні вже недоступний');
    }
  }

  private async assertNoBlockOrBookingConflict(
    manager: EntityManager,
    booking: Booking,
    table: TableEntity,
  ) {
    const requestedStart = this.timeToMinutes(booking.bookingTime);
    const requestedEnd = requestedStart + this.duration(booking) + CLEANUP_MINUTES;

    const blocks = await manager.getRepository(AvailabilityBlock).find({
      where: { blockDate: booking.bookingDate },
      relations: ['table', 'zone'],
    });
    const blocked = blocks.some((block) => {
      const applies = block.table?.id === table.id || Boolean(block.zone?.id && table.zone?.id === block.zone.id);
      if (!applies) return false;
      if (!block.startTime || !block.endTime) return true;
      return requestedStart < this.timeToMinutes(block.endTime) && requestedEnd > this.timeToMinutes(block.startTime);
    });
    if (blocked) throw new BadRequestException('На цей час стіл або локація недоступні');

    const active = await manager.getRepository(Booking)
      .createQueryBuilder('candidate')
      .leftJoin('candidate.table', 'table')
      .where('table.id = :tableId', { tableId: table.id })
      .andWhere('candidate.bookingDate = :bookingDate', { bookingDate: booking.bookingDate })
      .andWhere('candidate.status IN (:...statuses)', { statuses: ACTIVE_BOOKING_STATUSES })
      .andWhere('candidate.id != :bookingId', { bookingId: booking.id })
      .getMany();

    const conflict = active.some((candidate) => {
      const start = this.timeToMinutes(candidate.bookingTime);
      const end = start + this.duration(candidate) + CLEANUP_MINUTES;
      return requestedStart < end && requestedEnd > start;
    });
    if (conflict) throw new ConflictException('Цей стіл уже зайнятий на час бронювання');
  }

  private async saveHistory(
    manager: EntityManager,
    booking: Booking,
    action: string,
    newData: Record<string, unknown>,
    reason: string | null,
  ) {
    await manager.getRepository(BookingHistory).save(
      manager.getRepository(BookingHistory).create({
        booking,
        action,
        actorRole: action.startsWith('guest_') ? 'guest' : 'admin',
        actorStaffId: null,
        actorName: null,
        previousData: null,
        newData,
        reason,
        isManualMode: !action.startsWith('guest_'),
      }),
    );
  }

  private duration(booking: Booking) {
    const stored = Number(booking.durationMinutes);
    if (Number.isFinite(stored) && stored >= 30) return Math.min(720, Math.max(30, Math.round(stored)));
    return DEFAULT_DURATION_MINUTES;
  }

  private timeToMinutes(value: string) {
    const [hoursRaw, minutesRaw] = String(value || '').split(':');
    const hours = Number(hoursRaw);
    const minutes = Number(minutesRaw);
    if (!Number.isInteger(hours) || !Number.isInteger(minutes)) throw new BadRequestException('Невірний час бронювання');
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