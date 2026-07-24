import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';

import type { AuthUser } from '../auth/types/auth-user.type';
import { Client } from '../clients/entities/client.entity';
import { TableEntity } from '../tables/entities/table.entity';
import { AvailabilityBlock } from './entities/availability-block.entity';
import { BookingHistory } from './entities/booking-history.entity';
import { BookingRescheduleRequest } from './entities/booking-reschedule-request.entity';
import { Booking, BookingStatus } from './entities/booking.entity';
import { GuestReview } from './entities/guest-review.entity';

const ACTIVE_BOOKING_STATUSES: BookingStatus[] = ['pending', 'approved'];
const HISTORY_REQUEST_ACTIONS = [
  'guest_cancelled',
  'guest_reported_lateness',
  'guest_requested_table_change',
  'guest_called_admin',
] as const;
const RESOLUTION_ACTIONS = [
  'admin_acknowledged_attention',
  'admin_approved_table_change',
  'admin_rejected_table_change',
  'admin_accepted_call',
  'admin_completed_call',
  'admin_acknowledged_review',
] as const;
const DEFAULT_DURATION_MINUTES = 120;
const CLEANUP_MINUTES = 15;

@Injectable()
export class AdminAttentionService {
  constructor(private readonly dataSource: DataSource) {}

  async list() {
    const historyRepository = this.dataSource.getRepository(BookingHistory);
    const [pendingBookings, histories, reschedules, reviews] = await Promise.all([
      this.dataSource.getRepository(Booking).find({
        where: { status: 'pending' },
        relations: ['table', 'table.zone', 'client'],
        order: { createdAt: 'ASC' },
        take: 200,
      }),
      historyRepository.find({
        where: {
          action: In([...HISTORY_REQUEST_ACTIONS, ...RESOLUTION_ACTIONS]),
        },
        relations: ['booking', 'booking.table', 'booking.table.zone', 'booking.client'],
        order: { createdAt: 'DESC' },
        take: 600,
      }),
      this.dataSource.getRepository(BookingRescheduleRequest).find({
        where: { status: 'pending' },
        relations: ['booking', 'booking.table', 'booking.table.zone', 'booking.client'],
        order: { createdAt: 'DESC' },
        take: 150,
      }),
      this.dataSource.getRepository(GuestReview).find({
        relations: ['booking', 'booking.table', 'booking.table.zone', 'booking.client'],
        order: { createdAt: 'DESC' },
        take: 200,
      }),
    ]);

    const resolvedRequestIds = new Set<string>();
    const acceptedCallIds = new Set<string>();
    const completedCallIds = new Set<string>();
    const acknowledgedReviewIds = new Set<string>();

    for (const history of histories) {
      const requestId = String(history.newData?.requestId || '');
      if (requestId) resolvedRequestIds.add(requestId);
      if (history.action === 'admin_accepted_call' && requestId) {
        acceptedCallIds.add(requestId);
      }
      if (history.action === 'admin_completed_call' && requestId) {
        completedCallIds.add(requestId);
      }
      if (history.action === 'admin_acknowledged_review') {
        const reviewId = String(history.newData?.reviewId || '');
        if (reviewId) acknowledgedReviewIds.add(reviewId);
      }
    }

    const items: any[] = [];

    for (const booking of pendingBookings) {
      items.push({
        id: `booking:${booking.id}`,
        kind: 'booking_created',
        priority: 40,
        createdAt: booking.createdAt,
        booking,
      });
    }

    const freshThreshold = Date.now() - 7 * 24 * 60 * 60 * 1000;
    for (const history of histories) {
      if (!HISTORY_REQUEST_ACTIONS.includes(history.action as any)) continue;
      if (!history.booking) continue;
      if (new Date(history.createdAt).getTime() < freshThreshold) continue;

      if (history.action === 'guest_called_admin') {
        if (completedCallIds.has(history.id)) continue;
        items.push({
          id: `call:${history.id}`,
          requestId: history.id,
          kind: 'admin_call',
          priority: 5,
          status: acceptedCallIds.has(history.id) ? 'accepted' : 'new',
          createdAt: history.createdAt,
          reason: history.reason,
          booking: history.booking,
        });
        continue;
      }

      if (resolvedRequestIds.has(history.id)) continue;

      if (history.action === 'guest_requested_table_change') {
        items.push({
          id: `table-change:${history.id}`,
          requestId: history.id,
          kind: 'table_change',
          priority: 15,
          createdAt: history.createdAt,
          reason: history.reason,
          requestedTableId: history.newData?.requestedTableId || null,
          requestedTableNumber: history.newData?.requestedTableNumber || null,
          requestedZoneName: history.newData?.requestedZoneName || null,
          previousTableNumber: history.previousData?.tableNumber || null,
          booking: history.booking,
        });
        continue;
      }

      items.push({
        id: `event:${history.id}`,
        requestId: history.id,
        kind: history.action,
        priority: history.action === 'guest_cancelled' ? 10 : 20,
        createdAt: history.createdAt,
        reason: history.reason,
        booking: history.booking,
      });
    }

    for (const request of reschedules) {
      items.push({
        id: `reschedule:${request.id}`,
        requestId: request.id,
        kind: 'reschedule',
        priority: 12,
        createdAt: request.createdAt,
        requestedDate: request.requestedDate,
        requestedTime: request.requestedTime,
        booking: request.booking,
      });
    }

    for (const review of reviews) {
      if (acknowledgedReviewIds.has(review.id)) continue;
      items.push({
        id: `review:${review.id}`,
        requestId: review.id,
        kind: 'review',
        priority: 30,
        createdAt: review.createdAt,
        text: review.text,
        isPublished: review.isPublished,
        booking: review.booking,
      });
    }

    return items.sort((left, right) => {
      if (left.priority !== right.priority) return left.priority - right.priority;
      return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
    });
  }

  async acknowledgeHistory(requestId: string, actor?: AuthUser) {
    return this.dataSource.transaction(async (manager) => {
      const request = await this.findHistoryRequest(manager, requestId);
      await this.assertNotResolved(manager, request.id, [
        'admin_acknowledged_attention',
      ]);
      await this.saveResolution(
        manager,
        request.booking,
        'admin_acknowledged_attention',
        request.id,
        actor,
      );
      return { message: 'Подію опрацьовано' };
    });
  }

  async approveTableChange(requestId: string, tableId: string, actor?: AuthUser) {
    if (!tableId) throw new BadRequestException('Оберіть новий стіл');

    return this.dataSource.transaction(async (manager) => {
      const request = await this.findHistoryRequest(
        manager,
        requestId,
        'guest_requested_table_change',
      );
      await this.assertNotResolved(manager, request.id, [
        'admin_approved_table_change',
        'admin_rejected_table_change',
      ]);

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
      if (nextTable.id === booking.table?.id) {
        throw new BadRequestException('Оберіть інший стіл');
      }
      this.assertTableAvailable(nextTable);
      if (Number(nextTable.seats) < Number(booking.guestsCount)) {
        throw new BadRequestException('Обраний стіл не вміщує всіх гостей');
      }

      await this.assertNoAvailabilityBlock(manager, nextTable, booking);
      await this.assertNoBookingConflict(manager, nextTable.id, booking);

      const oldTable = booking.table?.id
        ? await tableRepository.findOne({
            where: { id: booking.table.id },
            relations: ['zone'],
            lock: { mode: 'pessimistic_write' },
          })
        : null;
      const oldTableNumber = oldTable?.tableNumber || null;

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

      if (booking.bookingDate === this.kyivDate()) {
        if (oldTable && !['closed', 'occupied', 'cleaning'].includes(oldTable.status)) {
          oldTable.status = 'free';
          await tableRepository.save(oldTable);
        }
        if (!['closed', 'occupied', 'cleaning'].includes(nextTable.status)) {
          nextTable.status = booking.status === 'approved' ? 'reserved' : 'pending';
          await tableRepository.save(nextTable);
        }
      }

      await this.saveResolution(
        manager,
        booking,
        'admin_approved_table_change',
        request.id,
        actor,
        {
          oldTableNumber,
          newTableNumber: nextTable.tableNumber,
        },
      );

      return { message: `Бронювання перенесено на стіл №${nextTable.tableNumber}` };
    });
  }

  async rejectTableChange(requestId: string, comment?: string, actor?: AuthUser) {
    return this.dataSource.transaction(async (manager) => {
      const request = await this.findHistoryRequest(
        manager,
        requestId,
        'guest_requested_table_change',
      );
      await this.assertNotResolved(manager, request.id, [
        'admin_approved_table_change',
        'admin_rejected_table_change',
      ]);
      const booking = await manager.getRepository(Booking).findOne({
        where: { id: request.booking.id },
        relations: ['table', 'client'],
        lock: { mode: 'pessimistic_write' },
      });
      if (!booking) throw new NotFoundException('Бронювання не знайдено');

      booking.guestNotification = {
        type: 'booking_updated',
        title: 'Запит на зміну столу відхилено',
        message: String(comment || '').trim() || 'Поточний стіл залишається без змін',
        previousTableNumber: booking.table?.tableNumber || null,
        newTableNumber: booking.table?.tableNumber || null,
        createdAt: new Date().toISOString(),
      };
      await manager.getRepository(Booking).save(booking);
      await this.saveResolution(
        manager,
        booking,
        'admin_rejected_table_change',
        request.id,
        actor,
        { comment: String(comment || '').trim() || null },
      );
      return { message: 'Запит на зміну столу відхилено' };
    });
  }

  async acceptAdminCall(requestId: string, actor?: AuthUser) {
    return this.dataSource.transaction(async (manager) => {
      const request = await this.findHistoryRequest(manager, requestId, 'guest_called_admin');
      await this.assertNotResolved(manager, request.id, ['admin_completed_call']);
      const alreadyAccepted = await this.hasResolution(
        manager,
        request.id,
        'admin_accepted_call',
      );
      if (!alreadyAccepted) {
        await this.saveResolution(
          manager,
          request.booking,
          'admin_accepted_call',
          request.id,
          actor,
        );
      }
      await this.setGuestCallNotification(
        manager,
        request.booking.id,
        'Адміністратор прийняв виклик',
        'Адміністратор уже прямує до вашого столу',
      );
      return { message: 'Виклик прийнято' };
    });
  }

  async completeAdminCall(requestId: string, actor?: AuthUser) {
    return this.dataSource.transaction(async (manager) => {
      const request = await this.findHistoryRequest(manager, requestId, 'guest_called_admin');
      await this.assertNotResolved(manager, request.id, ['admin_completed_call']);
      await this.saveResolution(
        manager,
        request.booking,
        'admin_completed_call',
        request.id,
        actor,
      );
      await this.setGuestCallNotification(
        manager,
        request.booking.id,
        'Виклик Адміністратора завершено',
        'Дякуємо за звернення',
      );
      return { message: 'Виклик завершено' };
    });
  }

  async acknowledgeReview(reviewId: string, actor?: AuthUser) {
    return this.dataSource.transaction(async (manager) => {
      const review = await manager.getRepository(GuestReview).findOne({
        where: { id: reviewId },
        relations: ['booking'],
      });
      if (!review) throw new NotFoundException('Відгук не знайдено');
      const alreadyAcknowledged = await manager.getRepository(BookingHistory).findOne({
        where: { action: 'admin_acknowledged_review' },
        order: { createdAt: 'DESC' },
      });
      if (
        alreadyAcknowledged &&
        String(alreadyAcknowledged.newData?.reviewId || '') === review.id
      ) {
        return { message: 'Відгук уже опрацьовано' };
      }
      await manager.getRepository(BookingHistory).save(
        manager.getRepository(BookingHistory).create({
          booking: review.booking,
          action: 'admin_acknowledged_review',
          actorRole: actor?.role || 'admin',
          actorStaffId: actor?.staffId || null,
          actorName: actor?.name || null,
          previousData: null,
          newData: { reviewId: review.id },
          reason: 'Відгук переглянуто Адміністратором',
          isManualMode: true,
        }),
      );
      return { message: 'Відгук опрацьовано' };
    });
  }

  async setRescheduleNotification(
    requestId: string,
    approved: boolean,
    comment?: string,
  ) {
    const request = await this.dataSource.getRepository(BookingRescheduleRequest).findOne({
      where: { id: requestId },
      relations: ['booking', 'booking.table'],
    });
    if (!request?.booking) return;
    request.booking.guestNotification = {
      type: 'booking_updated',
      title: approved ? 'Новий час підтверджено' : 'Запит на зміну часу відхилено',
      message: approved
        ? `${request.requestedDate} · ${String(request.requestedTime).slice(0, 5)}`
        : String(comment || '').trim() || 'Дата і час бронювання залишаються без змін',
      createdAt: new Date().toISOString(),
    };
    await this.dataSource.getRepository(Booking).save(request.booking);
  }

  private async findHistoryRequest(
    manager: EntityManager,
    id: string,
    expectedAction?: string,
  ) {
    const request = await manager.getRepository(BookingHistory).findOne({
      where: { id },
      relations: ['booking', 'booking.table', 'booking.client'],
      lock: { mode: 'pessimistic_write' },
    });
    if (!request) throw new NotFoundException('Подію не знайдено');
    if (expectedAction && request.action !== expectedAction) {
      throw new BadRequestException('Невірний тип події');
    }
    return request;
  }

  private async assertNotResolved(
    manager: EntityManager,
    requestId: string,
    actions: string[],
  ) {
    for (const action of actions) {
      if (await this.hasResolution(manager, requestId, action)) {
        throw new ConflictException('Цю подію вже опрацьовано');
      }
    }
  }

  private async hasResolution(
    manager: EntityManager,
    requestId: string,
    action: string,
  ) {
    const rows = await manager.getRepository(BookingHistory).find({
      where: { action },
      order: { createdAt: 'DESC' },
      take: 300,
    });
    return rows.some((row) => String(row.newData?.requestId || '') === requestId);
  }

  private async saveResolution(
    manager: EntityManager,
    booking: Booking,
    action: string,
    requestId: string,
    actor?: AuthUser,
    extra?: Record<string, unknown>,
  ) {
    await manager.getRepository(BookingHistory).save(
      manager.getRepository(BookingHistory).create({
        booking,
        action,
        actorRole: actor?.role || 'admin',
        actorStaffId: actor?.staffId || null,
        actorName: actor?.name || null,
        previousData: null,
        newData: { requestId, ...(extra || {}) },
        reason: null,
        isManualMode: true,
      }),
    );
  }

  private async setGuestCallNotification(
    manager: EntityManager,
    bookingId: string,
    title: string,
    message: string,
  ) {
    const booking = await manager.getRepository(Booking).findOne({
      where: { id: bookingId },
      relations: ['table'],
      lock: { mode: 'pessimistic_write' },
    });
    if (!booking) return;
    booking.guestNotification = {
      type: 'booking_updated',
      title,
      message,
      createdAt: new Date().toISOString(),
    };
    await manager.getRepository(Booking).save(booking);
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
      return start < this.timeToMinutes(block.endTime) && end > this.timeToMinutes(block.startTime);
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
