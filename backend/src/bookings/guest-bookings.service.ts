import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { DataSource, EntityManager, In, Repository } from 'typeorm';

import { Restaurant } from '../restaurant/entities/restaurant.entity';
import { TableEntity, TableStatus } from '../tables/entities/table.entity';
import { GuestBookingListDto } from './dto/guest-booking-list.dto';
import { GuestCancelBookingDto } from './dto/guest-cancel-booking.dto';
import { GuestChangeTableDto } from './dto/guest-change-table.dto';
import { GuestLatenessDto } from './dto/guest-lateness.dto';
import { GuestReviewDto } from './dto/guest-review.dto';
import { BookingHistory } from './entities/booking-history.entity';
import { Booking, BookingStatus } from './entities/booking.entity';
import { GuestReview } from './entities/guest-review.entity';

const KYIV_TIME_ZONE = 'Europe/Kyiv';
const DEFAULT_DURATION_MINUTES = 120;
const CLEANUP_MINUTES = 15;
const ACTIVE_BOOKING_STATUSES: BookingStatus[] = ['pending', 'approved'];

@Injectable()
export class GuestBookingsService {
  constructor(
    @InjectRepository(Booking)
    private readonly bookings: Repository<Booking>,
    @InjectRepository(GuestReview)
    private readonly reviews: Repository<GuestReview>,
    @InjectRepository(Restaurant)
    private readonly restaurants: Repository<Restaurant>,
    private readonly dataSource: DataSource,
  ) {}

  async list(dto: GuestBookingListDto) {
    const guestDeviceId = String(dto.guestDeviceId || '').trim();
    const tokens = [...new Set((dto.tokens || []).map((token) => String(token || '').trim()).filter(Boolean))].slice(0, 100);
    if (!guestDeviceId && tokens.length === 0) return [];

    const query = this.bookings
      .createQueryBuilder('booking')
      .leftJoinAndSelect('booking.table', 'table')
      .leftJoinAndSelect('table.zone', 'zone');

    query.andWhere((where) => {
      const conditions: string[] = [];

      if (guestDeviceId) {
        conditions.push(`(
          booking.guestDeviceIdHash = :guestDeviceIdHash
          AND booking.bookingDate >= :today
          AND booking.status IN (:...statuses)
        )`);
        where.setParameters({
          guestDeviceIdHash: this.hashDeviceId(guestDeviceId),
          today: this.kyivDate(),
          statuses: ACTIVE_BOOKING_STATUSES,
        });
      }

      if (tokens.length > 0) {
        conditions.push('booking.guestAccessTokenHash IN (:...hashes)');
        where.setParameter('hashes', tokens.map((token) => this.hashToken(token)));
      }

      return conditions.join(' OR ');
    });

    const bookings = await query.getMany();

    if (bookings.length === 0) return [];

    const reviews = await this.reviews.find({
      where: { booking: { id: In(bookings.map((booking) => booking.id)) } } as any,
      relations: ['booking'],
    });
    const reviewedIds = new Set(reviews.map((review) => review.booking.id));
    const phone = await this.restaurantPhone();

    const payloads = bookings.map((booking) =>
      this.payload(booking, reviewedIds.has(booking.id), phone),
    );

    return payloads.sort((left, right) => {
      const leftRank = this.bookingSortRank(left);
      const rightRank = this.bookingSortRank(right);
      if (leftRank !== rightRank) return leftRank - rightRank;

      const leftTime = `${left.bookingDate}T${left.bookingTime}`;
      const rightTime = `${right.bookingDate}T${right.bookingTime}`;
      return leftRank <= 1
        ? leftTime.localeCompare(rightTime)
        : rightTime.localeCompare(leftTime);
    });
  }

  async get(id: string, token: string) {
    const booking = await this.findOwnedBooking(id, token);
    const reviewExists = await this.reviews.exist({ where: { booking: { id: booking.id } } as any });
    return this.payload(booking, reviewExists, await this.restaurantPhone());
  }

  async cancel(id: string, token: string, dto: GuestCancelBookingDto) {
    await this.dataSource.transaction(async (manager) => {
      const booking = await this.findOwnedBooking(id, token, manager, true);
      this.assertGuestCanManageActiveBooking(booking, 'Скасування цієї броні вже недоступне');

      const previousData = this.snapshot(booking);
      booking.status = 'cancelled';
      booking.cancelledAt = new Date();
      booking.cancellationReason = String(dto.reason || '').trim() || 'guest_cancelled';
      await manager.getRepository(Booking).save(booking);

      await this.saveHistory(manager, booking, 'guest_cancelled', {
        previousData,
        newData: this.snapshot(booking),
        reason: booking.cancellationReason,
      });

      if (booking.table?.id) {
        await this.synchronizeTableForDate(manager, booking.table.id, booking.bookingDate);
      }
    });

    return {
      message: 'Бронювання скасовано',
      booking: await this.get(id, token),
    };
  }

  async reportLateness(id: string, token: string, dto: GuestLatenessDto) {
    const totalMinutes = Number(dto.hours) * 60 + Number(dto.minutes);
    if (totalMinutes <= 0 || totalMinutes > 12 * 60) {
      throw new BadRequestException('Вкажіть запізнення від 1 хвилини до 12 годин');
    }

    await this.dataSource.transaction(async (manager) => {
      const booking = await this.findOwnedBooking(id, token, manager, true);

      if (booking.status !== 'approved' || booking.checkedInAt) {
        throw new BadRequestException('Повідомити про запізнення для цієї броні неможливо');
      }
      if (!this.isToday(booking.bookingDate)) {
        throw new BadRequestException('Запізнення можна вказати лише для сьогоднішньої броні');
      }
      if (booking.lateNotifiedAt) {
        throw new ConflictException('Запізнення вже повідомлено');
      }

      const bookingAt = this.kyivLocalDateTimeToUtc(booking.bookingDate, booking.bookingTime);
      if (Date.now() < bookingAt.getTime() + 60_000) {
        throw new BadRequestException('Повідомити про запізнення можна через хвилину після часу бронювання');
      }

      const previousData = this.snapshot(booking);
      booking.lateNotifiedAt = new Date();
      booking.latenessHours = Number(dto.hours);
      booking.latenessMinutes = Number(dto.minutes);
      booking.expectedArrivalAt = new Date(bookingAt.getTime() + totalMinutes * 60_000);
      await manager.getRepository(Booking).save(booking);

      await this.saveHistory(manager, booking, 'guest_reported_lateness', {
        previousData,
        newData: this.snapshot(booking),
        reason: `Запізнення ${dto.hours} год ${dto.minutes} хв`,
      });
    });

    return {
      message: 'Адміністратора та офіціанта повідомлено про запізнення',
      booking: await this.get(id, token),
    };
  }

  async changeTable(id: string, token: string, dto: GuestChangeTableDto) {
    const tableId = String(dto.tableId || '').trim();
    const tableNumber = String(dto.tableNumber || '').trim();
    if (!tableId && !tableNumber) {
      throw new BadRequestException('Оберіть новий стіл');
    }

    await this.dataSource.transaction(async (manager) => {
      const booking = await this.findOwnedBooking(id, token, manager, true);
      this.assertGuestCanManageActiveBooking(booking, 'Зміна столу для цієї броні вже недоступна');

      const tableRepository = manager.getRepository(TableEntity);
      let query = tableRepository
        .createQueryBuilder('table')
        .leftJoinAndSelect('table.zone', 'zone')
        .setLock('pessimistic_write', undefined, ['table']);

      query = tableId
        ? query.where('table.id = :tableId', { tableId })
        : query.where('table.tableNumber = :tableNumber', { tableNumber });

      const newTable = await query.getOne();
      if (!newTable) throw new BadRequestException('Стіл не знайдено');

      if (booking.table?.id === newTable.id) return;
      if (!newTable.isVisible || newTable.status === 'closed' || newTable.zone?.isClosed || newTable.zone?.isVisible === false) {
        throw new BadRequestException('Цей стіл зараз недоступний');
      }
      if (Number(newTable.seats) < Number(booking.guestsCount)) {
        throw new BadRequestException('Для вашої кількості гостей потрібен більший стіл');
      }

      const activeBookings = await manager
        .getRepository(Booking)
        .createQueryBuilder('candidate')
        .leftJoinAndSelect('candidate.table', 'table')
        .where('table.id = :tableId', { tableId: newTable.id })
        .andWhere('candidate.bookingDate = :bookingDate', { bookingDate: booking.bookingDate })
        .andWhere('candidate.status IN (:...statuses)', { statuses: ACTIVE_BOOKING_STATUSES })
        .andWhere('candidate.id != :bookingId', { bookingId: booking.id })
        .getMany();

      const requestedStart = this.timeToMinutes(booking.bookingTime);
      const requestedAvailableFrom = requestedStart + this.duration(booking) + CLEANUP_MINUTES;
      const conflict = activeBookings.some((candidate) => {
        const candidateStart = this.timeToMinutes(candidate.bookingTime);
        const candidateAvailableFrom = candidateStart + this.duration(candidate) + CLEANUP_MINUTES;
        return requestedStart < candidateAvailableFrom && requestedAvailableFrom > candidateStart;
      });

      if (conflict) {
        throw new ConflictException('Цей стіл уже недоступний. Оберіть інший.');
      }

      const previousTableId = booking.table?.id || null;
      const previousData = this.snapshot(booking);
      booking.table = newTable;
      booking.guestNotification = null;
      await manager.getRepository(Booking).save(booking);

      await this.saveHistory(manager, booking, 'guest_changed_table', {
        previousData,
        newData: this.snapshot(booking),
        reason: 'Гість самостійно змінив стіл',
      });

      if (previousTableId) {
        await this.synchronizeTableForDate(manager, previousTableId, booking.bookingDate);
      }
      await this.applyBookingStatusToTable(manager, newTable.id, booking.bookingDate, booking.status);
    });

    return {
      message: 'Стіл успішно змінено',
      booking: await this.get(id, token),
    };
  }

  async acknowledgeNotification(id: string, token: string) {
    await this.dataSource.transaction(async (manager) => {
      const booking = await this.findOwnedBooking(id, token, manager, true);
      if (!booking.guestNotification || booking.guestNotification.acknowledgedAt) return;

      booking.guestNotification = {
        ...booking.guestNotification,
        acknowledgedAt: new Date().toISOString(),
      };
      await manager.getRepository(Booking).save(booking);
      await this.saveHistory(manager, booking, 'guest_acknowledged_notification', {
        newData: { guestNotification: booking.guestNotification },
      });
    });

    return { message: 'Повідомлення прочитано' };
  }

  async submitReview(id: string, token: string, dto: GuestReviewDto) {
    const text = String(dto.text || '').trim();
    if (text.length < 2) throw new BadRequestException('Напишіть відгук');

    await this.dataSource.transaction(async (manager) => {
      const booking = await this.findOwnedBooking(id, token, manager, true);
      if (booking.status !== 'completed' || !booking.checkedInAt) {
        throw new BadRequestException('Відгук можна залишити лише після завершеного візиту');
      }

      const reviewRepository = manager.getRepository(GuestReview);
      const existing = await reviewRepository.findOne({ where: { booking: { id: booking.id } } as any });
      if (existing) throw new ConflictException('Відгук для цього візиту вже залишено');

      await reviewRepository.save(
        reviewRepository.create({
          booking,
          text,
          isPublished: false,
          publishedAt: null,
          externalReviewOpenedAt: null,
        }),
      );
      await this.saveHistory(manager, booking, 'guest_submitted_review', {
        newData: { reviewLength: text.length, isPublished: false },
      });
    });

    return {
      message: 'Дякуємо за ваш відгук!',
      askExternalReview: true,
    };
  }

  async markExternalReviewOpened(id: string, token: string) {
    await this.dataSource.transaction(async (manager) => {
      const booking = await this.findOwnedBooking(id, token, manager, true);
      const reviewRepository = manager.getRepository(GuestReview);
      const review = await reviewRepository.findOne({ where: { booking: { id: booking.id } } as any });
      if (!review) throw new BadRequestException('Спочатку надішліть відгук');

      review.externalReviewOpenedAt = new Date();
      await reviewRepository.save(review);
      await this.saveHistory(manager, booking, 'guest_opened_external_review', {
        newData: { externalReviewOpenedAt: review.externalReviewOpenedAt.toISOString() },
      });
    });

    return { message: 'Перехід до відгуків зафіксовано' };
  }

  private async findOwnedBooking(
    id: string,
    token: string,
    manager?: EntityManager,
    lock = false,
  ) {
    const hash = this.hashToken(token);
    const repository = manager ? manager.getRepository(Booking) : this.bookings;
    let query = repository
      .createQueryBuilder('booking')
      .leftJoinAndSelect('booking.table', 'table')
      .leftJoinAndSelect('table.zone', 'zone')
      .leftJoinAndSelect('booking.client', 'client')
      .where('booking.id = :id', { id })
      .andWhere('booking.guestAccessTokenHash = :hash', { hash });

    if (lock) query = query.setLock('pessimistic_write', undefined, ['booking']);
    const booking = await query.getOne();
    if (!booking) {
      throw new UnauthorizedException('Недійсний доступ до бронювання');
    }
    return booking;
  }

  private hashToken(token: string) {
    const normalized = String(token || '').trim();
    if (!normalized || normalized.length > 256) {
      throw new UnauthorizedException('Недійсний доступ до бронювання');
    }
    return createHash('sha256').update(normalized).digest('hex');
  }

  private hashDeviceId(deviceId: string) {
    return createHash('sha256').update(deviceId).digest('hex');
  }

  private assertGuestCanManageActiveBooking(booking: Booking, message: string) {
    if (!ACTIVE_BOOKING_STATUSES.includes(booking.status) || booking.checkedInAt) {
      throw new BadRequestException(message);
    }
  }

  private async synchronizeTableForDate(manager: EntityManager, tableId: string, bookingDate: string) {
    if (!this.isToday(bookingDate)) return;

    const tableRepository = manager.getRepository(TableEntity);
    const table = await tableRepository
      .createQueryBuilder('table')
      .where('table.id = :tableId', { tableId })
      .setLock('pessimistic_write')
      .getOne();
    if (!table) return;

    if (table.status === 'closed' || table.status === 'cleaning' || table.status === 'occupied') return;

    const active = await manager.getRepository(Booking).find({
      where: {
        table: { id: tableId },
        bookingDate,
        status: In(ACTIVE_BOOKING_STATUSES),
      } as any,
      relations: ['table'],
    });

    let nextStatus: TableStatus = 'free';
    if (active.some((booking) => booking.status === 'approved')) nextStatus = 'reserved';
    else if (active.some((booking) => booking.status === 'pending')) nextStatus = 'pending';

    if (table.status !== nextStatus) {
      table.status = nextStatus;
      await tableRepository.save(table);
    }
  }

  private async applyBookingStatusToTable(
    manager: EntityManager,
    tableId: string,
    bookingDate: string,
    bookingStatus: BookingStatus,
  ) {
    if (!this.isToday(bookingDate)) return;

    const tableRepository = manager.getRepository(TableEntity);
    const table = await tableRepository.findOne({ where: { id: tableId } });
    if (!table || ['closed', 'cleaning', 'occupied'].includes(table.status)) return;

    table.status = bookingStatus === 'approved' ? 'reserved' : 'pending';
    await tableRepository.save(table);
  }

  private async saveHistory(
    manager: EntityManager,
    booking: Booking,
    action: string,
    data: {
      previousData?: Record<string, unknown> | null;
      newData?: Record<string, unknown> | null;
      reason?: string | null;
    },
  ) {
    const repository = manager.getRepository(BookingHistory);
    await repository.save(
      repository.create({
        booking,
        action,
        actorRole: 'guest',
        actorStaffId: null,
        actorName: null,
        previousData: data.previousData || null,
        newData: data.newData || null,
        reason: data.reason || null,
        isManualMode: false,
      }),
    );
  }

  private payload(booking: Booking, reviewExists: boolean, restaurantPhone: string | null) {
    const canManage = ACTIVE_BOOKING_STATUSES.includes(booking.status) && !booking.checkedInAt;
    const canReportLateness = Boolean(
      booking.status === 'approved' &&
        !booking.checkedInAt &&
        !booking.lateNotifiedAt &&
        this.isToday(booking.bookingDate),
    );
    const expectedArrivalOverdue = Boolean(
      booking.status === 'approved' &&
        !booking.checkedInAt &&
        booking.expectedArrivalAt &&
        Date.now() > new Date(booking.expectedArrivalAt).getTime(),
    );

    return {
      bookingId: booking.id,
      status: booking.status,
      tableId: booking.table?.id || null,
      tableNumber: booking.table?.tableNumber || null,
      zoneId: booking.table?.zone?.id || null,
      zoneName: booking.table?.zone?.name || null,
      bookingDate: booking.bookingDate,
      bookingTime: booking.bookingTime,
      durationMinutes: this.duration(booking),
      guestsCount: booking.guestsCount,
      wishes: booking.wishes,
      createdAt: booking.createdAt,
      approvedAt: booking.approvedAt,
      rejectedAt: booking.rejectedAt,
      checkedInAt: booking.checkedInAt,
      cancelledAt: booking.cancelledAt,
      completedAt: booking.completedAt,
      cancellationReason: booking.cancellationReason,
      lateNotifiedAt: booking.lateNotifiedAt,
      latenessHours: booking.latenessHours,
      latenessMinutes: booking.latenessMinutes,
      expectedArrivalAt: booking.expectedArrivalAt,
      isLatenessPromptDue: this.isLatenessPromptDue(booking),
      isExpectedArrivalOverdue: expectedArrivalOverdue,
      canGuestCancel: canManage,
      canGuestChangeTable: canManage,
      canGuestChangeTime: false,
      canReportLateness,
      canLeaveReview: booking.status === 'completed' && Boolean(booking.checkedInAt) && !reviewExists,
      guestNotification: booking.guestNotification,
      restaurantPhone,
    };
  }

  private isLatenessPromptDue(booking: Booking) {
    if (
      booking.status !== 'approved' ||
      booking.checkedInAt ||
      booking.lateNotifiedAt ||
      !this.isToday(booking.bookingDate)
    ) {
      return false;
    }

    const bookingAt = this.kyivLocalDateTimeToUtc(booking.bookingDate, booking.bookingTime);
    return Date.now() >= bookingAt.getTime() + 60_000;
  }

  private duration(booking: Booking) {
    if (Number.isFinite(Number(booking.durationMinutes)) && Number(booking.durationMinutes) >= 30) {
      return Math.min(720, Math.round(Number(booking.durationMinutes)));
    }

    const match = String(booking.wishes || '').match(/\((\d{2}:\d{2})\s*[—-]\s*(\d{2}:\d{2})\)/);
    if (!match) return DEFAULT_DURATION_MINUTES;

    const start = this.timeToMinutes(match[1]);
    const end = this.timeToMinutes(match[2]);
    const duration = end >= start ? end - start : end + 1440 - start;
    return Math.min(720, Math.max(30, duration));
  }

  private timeToMinutes(time: string) {
    const [hoursRaw, minutesRaw] = String(time || '').split(':');
    const hours = Number(hoursRaw);
    const minutes = Number(minutesRaw);
    if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
      throw new BadRequestException('Невірний формат часу бронювання');
    }
    return hours * 60 + minutes;
  }

  private bookingSortRank(booking: { bookingDate: string; status: BookingStatus }) {
    const today = this.kyivDate();
    const active = ACTIVE_BOOKING_STATUSES.includes(booking.status);
    if (active && booking.bookingDate === today) return 0;
    if (active && booking.bookingDate > today) return 1;
    return 2;
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
      cancelledAt: booking.cancelledAt,
      cancellationReason: booking.cancellationReason,
      lateNotifiedAt: booking.lateNotifiedAt,
      latenessHours: booking.latenessHours,
      latenessMinutes: booking.latenessMinutes,
      expectedArrivalAt: booking.expectedArrivalAt,
    };
  }

  private async restaurantPhone() {
    const restaurants = await this.restaurants.find({ order: { createdAt: 'ASC' }, take: 1 });
    return restaurants[0]?.phone || null;
  }

  private isToday(date: string) {
    return String(date || '') === this.kyivDate();
  }

  private kyivDate() {
    return this.kyivParts(new Date()).date;
  }

  private kyivLocalDateTimeToUtc(date: string, time: string) {
    const [year, month, day] = String(date).split('-').map(Number);
    const [hour, minute, second = 0] = String(time).split(':').map(Number);
    const target = Date.UTC(year, month - 1, day, hour, minute, second);
    let guess = target;

    for (let index = 0; index < 3; index += 1) {
      const parts = this.kyivParts(new Date(guess));
      const represented = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
      guess += target - represented;
    }

    return new Date(guess);
  }

  private kyivParts(date: Date) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: KYIV_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date);

    const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value || 0);
    const year = value('year');
    const month = value('month');
    const day = value('day');
    const hour = value('hour');
    const minute = value('minute');
    const second = value('second');

    return {
      year,
      month,
      day,
      hour,
      minute,
      second,
      date: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    };
  }
}
