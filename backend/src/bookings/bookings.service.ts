import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'crypto';
import { Repository } from 'typeorm';
import { Booking, BookingStatus } from './entities/booking.entity';
import { BookingHistory } from './entities/booking-history.entity';
import { BookingRescheduleRequest } from './entities/booking-reschedule-request.entity';
import { Client } from '../clients/entities/client.entity';
import { TableEntity } from '../tables/entities/table.entity';
import { Restaurant } from '../restaurant/entities/restaurant.entity';
import { CreateBookingDto } from './dto/create-booking.dto';
import { CheckAvailabilityDto } from './dto/check-availability.dto';
import { RequestRescheduleDto } from './dto/request-reschedule.dto';
import { RejectRescheduleDto } from './dto/reject-reschedule.dto';
import { LogsService } from '../logs/logs.service';
import { NotificationsService } from '../notifications/notifications.service';
import { WaiterCallsService } from '../waiter-calls/waiter-calls.service';
import type { AuthUser } from '../auth/types/auth-user.type';

const DEFAULT_DURATION_MINUTES = 120;
const DEFAULT_CLEANUP_MINUTES = 15;
const PENDING_REMINDER_MINUTES = 15;
const ACTIVE_BOOKING_STATUSES: BookingStatus[] = ['pending', 'approved'];

@Injectable()
export class BookingsService {
  constructor(
    @InjectRepository(Booking) private readonly bookings: Repository<Booking>,
    @InjectRepository(BookingHistory) private readonly histories: Repository<BookingHistory>,
    @InjectRepository(BookingRescheduleRequest) private readonly reschedules: Repository<BookingRescheduleRequest>,
    @InjectRepository(Client) private readonly clients: Repository<Client>,
    @InjectRepository(TableEntity) private readonly tables: Repository<TableEntity>,
    @InjectRepository(Restaurant) private readonly restaurants: Repository<Restaurant>,
    private readonly logs: LogsService,
    private readonly notifications: NotificationsService,
    private readonly waiterCalls: WaiterCallsService,
  ) {}

  async restaurant() {
    const restaurants = await this.restaurants.find({ order: { createdAt: 'ASC' }, take: 1 });
    const restaurant = restaurants[0];
    if (!restaurant) throw new NotFoundException('Ресторан не знайдено');
    return restaurant;
  }

  async validateRestaurant() {
    const restaurant = await this.restaurant();
    if (restaurant.status === 'closed') throw new BadRequestException(restaurant.closeMessage);
    if (restaurant.status === 'booking_closed') throw new BadRequestException(restaurant.bookingClosedMessage);
  }

  private normalizePhone(phone: string | null | undefined) {
    return String(phone || '').replace(/\D/g, '');
  }

  private hashGuestDeviceId(guestDeviceId: string) {
    return createHash('sha256').update(String(guestDeviceId).trim()).digest('hex');
  }

  private async assertNoActiveGuestBooking(bookingDate: string, phone: string, guestDeviceIdHash: string) {
    const activeBookings = await this.bookings
      .createQueryBuilder('booking')
      .leftJoinAndSelect('booking.client', 'client')
      .addSelect('booking.guestDeviceIdHash')
      .where('booking.bookingDate = :bookingDate', { bookingDate })
      .andWhere('booking.status IN (:...statuses)', { statuses: ACTIVE_BOOKING_STATUSES })
      .getMany();
    const normalizedPhone = this.normalizePhone(phone);
    const duplicate = activeBookings.some((booking) =>
      booking.guestDeviceIdHash === guestDeviceIdHash ||
      this.normalizePhone(booking.client?.phone) === normalizedPhone,
    );

    if (duplicate) {
      throw new BadRequestException('На цю дату вже є активне бронювання з цього пристрою або номера телефону');
    }
  }

  private normalizeDuration(durationMinutes?: number) {
    const value = Number(durationMinutes || DEFAULT_DURATION_MINUTES);
    if (!Number.isFinite(value)) return DEFAULT_DURATION_MINUTES;
    return Math.min(720, Math.max(30, Math.round(value)));
  }

  private parseTimeToMinutes(time: string) {
    const [hoursRaw, minutesRaw] = String(time).split(':');
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

  private formatTimeFromMinutes(totalMinutes: number) {
    const normalized = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
    const hours = Math.floor(normalized / 60);
    const minutes = normalized % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;
  }

  private formatTimeLabel(time: string | null | undefined) {
    if (!time) return '-';
    const [hours = '00', minutes = '00'] = String(time).split(':');
    return `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}`;
  }

  private buildTimeInfo(bookingTime: string, durationMinutes?: number) {
    const startMinutes = this.parseTimeToMinutes(bookingTime);
    const normalizedDuration = this.normalizeDuration(durationMinutes);
    const departureMinutes = startMinutes + normalizedDuration;
    const availableFromMinutes = departureMinutes + DEFAULT_CLEANUP_MINUTES;

    return {
      startMinutes,
      durationMinutes: normalizedDuration,
      cleanupMinutes: DEFAULT_CLEANUP_MINUTES,
      departureMinutes,
      availableFromMinutes,
      bookingTime: this.formatTimeFromMinutes(startMinutes),
      departureTime: this.formatTimeFromMinutes(departureMinutes),
      availableFrom: this.formatTimeFromMinutes(availableFromMinutes),
      bookingTimeLabel: this.formatTimeLabel(this.formatTimeFromMinutes(startMinutes)),
      departureTimeLabel: this.formatTimeLabel(this.formatTimeFromMinutes(departureMinutes)),
      availableFromLabel: this.formatTimeLabel(this.formatTimeFromMinutes(availableFromMinutes)),
    };
  }

  private durationFromWishes(booking: Booking) {
    const storedDuration = Number(booking.durationMinutes);
    if (Number.isFinite(storedDuration) && storedDuration >= 30) {
      return this.normalizeDuration(storedDuration);
    }

    const wishes = booking.wishes || '';
    const match = wishes.match(/\((\d{2}:\d{2})\s*[—-]\s*(\d{2}:\d{2})\)/);

    if (!match) return DEFAULT_DURATION_MINUTES;

    const start = this.parseTimeToMinutes(match[1]);
    const end = this.parseTimeToMinutes(match[2]);
    const duration = end >= start ? end - start : end + 1440 - start;

    return this.normalizeDuration(duration);
  }

  private getBookingStartMinutes(booking: Booking) {
    return this.parseTimeToMinutes(booking.bookingTime);
  }

  private getBookingDepartureMinutes(booking: Booking) {
    const start = this.getBookingStartMinutes(booking);
    return start + this.durationFromWishes(booking);
  }

  private getBookingAvailableFromMinutes(booking: Booking) {
    return this.getBookingDepartureMinutes(booking) + DEFAULT_CLEANUP_MINUTES;
  }

  private bookingToAvailabilityConflict(booking: Booking) {
    const startMinutes = this.getBookingStartMinutes(booking);
    const departureMinutes = this.getBookingDepartureMinutes(booking);
    const availableFromMinutes = this.getBookingAvailableFromMinutes(booking);

    const bookedFrom = booking.bookingTime || this.formatTimeFromMinutes(startMinutes);
    const bookedTo = this.formatTimeFromMinutes(departureMinutes);
    const availableFrom = this.formatTimeFromMinutes(availableFromMinutes);

    return {
      bookingId: booking.id,
      status: booking.status,
      tableNumber: booking.table?.tableNumber || null,
      bookedFrom,
      bookedTo,
      availableFrom,
      bookedFromLabel: this.formatTimeLabel(bookedFrom),
      bookedToLabel: this.formatTimeLabel(bookedTo),
      availableFromLabel: this.formatTimeLabel(availableFrom),
    };
  }

  private async getActiveBookingsForTable(tableId: string, bookingDate: string, excludeBookingId?: string) {
    const query = this.bookings
      .createQueryBuilder('booking')
      .leftJoinAndSelect('booking.table', 'table')
      .leftJoinAndSelect('booking.client', 'client')
      .where('table.id = :tableId', { tableId })
      .andWhere('booking.bookingDate = :bookingDate', { bookingDate })
      .andWhere('booking.status IN (:...statuses)', { statuses: ACTIVE_BOOKING_STATUSES })
      .orderBy('booking.bookingTime', 'ASC');

    if (excludeBookingId) query.andWhere('booking.id != :excludeBookingId', { excludeBookingId });
    return query.getMany();
  }

  private findConflict(activeBookings: Booking[], requestedStartMinutes: number, requestedAvailableFromMinutes: number) {
    return activeBookings.find((booking) => {
      const existingStart = this.getBookingStartMinutes(booking);
      const existingAvailableFrom = this.getBookingAvailableFromMinutes(booking);
      return requestedStartMinutes < existingAvailableFrom && requestedAvailableFromMinutes > existingStart;
    });
  }

  private async assertTableCanBeBooked(table: TableEntity) {
    if (!table.isVisible) throw new BadRequestException('Стіл зараз недоступний для онлайн-бронювання');
    if (table.status === 'closed') throw new BadRequestException('Стіл зараз закритий для бронювання');

    if (table.zone?.isClosed || table.zone?.isVisible === false) {
      throw new BadRequestException('Ця зона зараз закрита для бронювання');
    }
  }

  private async resolveTableForBooking(dto: CreateBookingDto) {
    let table: TableEntity | null = null;
    const tableId = String(dto.tableId || '');

    if (dto.tableId && !tableId.startsWith('visual-')) {
      table = await this.tables.findOne({ where: { id: dto.tableId }, relations: ['zone'] });
    }

    if (!table && dto.tableNumber) {
      table = await this.tables.findOne({ where: { tableNumber: String(dto.tableNumber) }, relations: ['zone'] });
    }

    if (!table && dto.tableNumber) {
      table = await this.tables.save(
        this.tables.create({
          tableNumber: String(dto.tableNumber),
          seats: dto.seats || dto.guestsCount || 4,
          shape: 'rectangle',
          photoUrl: null,
          x: 0,
          y: 0,
          width: 100,
          height: 80,
          rotation: 0,
          status: 'free',
          isVisible: true,
        }),
      );

      table = await this.tables.findOne({ where: { id: table.id }, relations: ['zone'] });
    }

    if (!table) throw new NotFoundException('Стіл не знайдено');
    return table;
  }

  private async assertNoTimeConflict(
    tableId: string,
    bookingDate: string,
    bookingTime: string,
    durationMinutes?: number,
    excludeBookingId?: string,
  ) {
    const timeInfo = this.buildTimeInfo(bookingTime, durationMinutes);
    const activeBookings = await this.getActiveBookingsForTable(tableId, bookingDate, excludeBookingId);
    const conflict = this.findConflict(activeBookings, timeInfo.startMinutes, timeInfo.availableFromMinutes);

    if (conflict) {
      const conflictInfo = this.bookingToAvailabilityConflict(conflict);
      throw new BadRequestException(
        `Стіл зайнятий ${conflictInfo.bookedFromLabel} — ${conflictInfo.bookedToLabel}. Вільний з ${conflictInfo.availableFromLabel}`,
      );
    }

    return timeInfo;
  }

  private async setTableStatus(table: TableEntity | null, status: TableEntity['status']) {
    if (!table) return;
    table.status = status;
    await this.tables.save(table);
  }

  private restaurantDateToday() {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Kyiv',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());

    const year = parts.find((part) => part.type === 'year')?.value || '1970';
    const month = parts.find((part) => part.type === 'month')?.value || '01';
    const day = parts.find((part) => part.type === 'day')?.value || '01';

    return `${year}-${month}-${day}`;
  }

  private isBookingToday(bookingDate: string | null | undefined) {
    return String(bookingDate || '') === this.restaurantDateToday();
  }

  private async setTableStatusOnlyForToday(
    table: TableEntity | null,
    status: TableEntity['status'],
    bookingDate: string,
    force = false,
  ) {
    if (!table) return;

    // Майбутня бронь не повинна фарбувати фізичний стіл сьогодні.
    if (!this.isBookingToday(bookingDate)) return;

    // Закритий стіл автоматично не відкриваємо. Фізичні occupied/cleaning
    // мають пріоритет над pending/reserved та звичайним скасуванням броні.
    if (table.status === 'closed') return;
    if (!force && (table.status === 'occupied' || table.status === 'cleaning')) return;

    await this.setTableStatus(table, status);
  }

  private async safeLog(action: string, details?: Record<string, unknown>) {
    try {
      await this.logs.create(action, null, details || {});
    } catch (error) {
      console.error('Booking log failed:', error);
    }
  }

  private async safeNotify(action: () => Promise<unknown>) {
    try {
      await action();
    } catch (error) {
      console.error('Booking notification failed:', error);
    }
  }

  private async saveHistory(
    booking: Booking,
    action: string,
    actorRole: string,
    previousData?: Record<string, unknown> | null,
    newData?: Record<string, unknown> | null,
    reason?: string | null,
  ) {
    await this.histories.save(
      this.histories.create({
        booking,
        action,
        actorRole,
        actorStaffId: null,
        actorName: null,
        previousData: previousData || null,
        newData: newData || null,
        reason: reason || null,
        isManualMode: false,
      }),
    );
  }

  private bookingSnapshot(booking: Booking) {
    return {
      status: booking.status,
      tableId: booking.table?.id || null,
      tableNumber: booking.table?.tableNumber || null,
      bookingDate: booking.bookingDate,
      bookingTime: booking.bookingTime,
      durationMinutes: this.durationFromWishes(booking),
      checkedInAt: booking.checkedInAt,
      cancelledAt: booking.cancelledAt,
      cancellationReason: booking.cancellationReason,
      completedAt: booking.completedAt,
      expectedArrivalAt: booking.expectedArrivalAt,
    };
  }

  private markNoShowInWishes(booking: Booking) {
    const current = booking.wishes || '';
    if (current.includes('[NO_SHOW]')) return current;
    return [current, `[NO_SHOW] Гість не прийшов. Бронь знято адміністратором ${new Date().toISOString()}.`]
      .filter(Boolean)
      .join('\n');
  }


  private pendingAgeMinutes(booking: Booking) {
    if (!booking.createdAt) return 0;

    const createdAt = new Date(booking.createdAt).getTime();
    if (!Number.isFinite(createdAt)) return 0;

    return Math.max(0, Math.floor((Date.now() - createdAt) / 60000));
  }

  private isPendingReminderDue(booking: Booking) {
    return booking.status === 'pending' && this.pendingAgeMinutes(booking) >= PENDING_REMINDER_MINUTES;
  }

  private async publicBookingStatusPayload(booking: Booking) {
    let restaurantPhone: string | null = null;

    try {
      const restaurant = await this.restaurant();
      restaurantPhone = restaurant.phone || null;
    } catch {
      restaurantPhone = null;
    }

    const ageMinutes = this.pendingAgeMinutes(booking);
    const timeInfo = this.bookingToAvailabilityConflict(booking);

    return {
      bookingId: booking.id,
      status: booking.status,
      tableNumber: booking.table?.tableNumber || null,
      bookingDate: booking.bookingDate,
      bookingTime: booking.bookingTime,
      bookedFrom: timeInfo.bookedFrom,
      bookedTo: timeInfo.bookedTo,
      availableFrom: timeInfo.availableFrom,
      bookedFromLabel: timeInfo.bookedFromLabel,
      bookedToLabel: timeInfo.bookedToLabel,
      availableFromLabel: timeInfo.availableFromLabel,
      guestsCount: booking.guestsCount,
      durationMinutes: this.durationFromWishes(booking),
      checkedInAt: booking.checkedInAt,
      cancellationReason: booking.cancellationReason,
      lateNotifiedAt: booking.lateNotifiedAt,
      latenessHours: booking.latenessHours,
      latenessMinutes: booking.latenessMinutes,
      expectedArrivalAt: booking.expectedArrivalAt,
      guestNotification: booking.guestNotification,
      createdAt: booking.createdAt,
      approvedAt: booking.approvedAt,
      rejectedAt: booking.rejectedAt,
      cancelledAt: booking.cancelledAt,
      completedAt: booking.completedAt,
      pendingAgeMinutes: ageMinutes,
      pendingReminderMinutes: PENDING_REMINDER_MINUTES,
      isPendingTooLong: this.isPendingReminderDue(booking),
      restaurantPhone,
    };
  }

  async checkAvailability(dto: CheckAvailabilityDto) {
    const table = await this.tables.findOne({ where: { id: dto.tableId }, relations: ['zone'] });
    if (!table) throw new NotFoundException('Стіл не знайдено');

    const timeInfo = this.buildTimeInfo(dto.bookingTime, dto.durationMinutes);

    if (!table.isVisible || table.status === 'closed' || table.zone?.isClosed || table.zone?.isVisible === false) {
      return {
        tableId: table.id,
        tableNumber: table.tableNumber,
        bookingDate: dto.bookingDate,
        requestedFrom: timeInfo.bookingTime,
        requestedTo: timeInfo.departureTime,
        requestedAvailableFrom: timeInfo.availableFrom,
        requestedFromLabel: timeInfo.bookingTimeLabel,
        requestedToLabel: timeInfo.departureTimeLabel,
        requestedAvailableFromLabel: timeInfo.availableFromLabel,
        durationMinutes: timeInfo.durationMinutes,
        cleanupMinutes: timeInfo.cleanupMinutes,
        isAvailable: false,
        reason: table.status === 'closed' ? 'table_closed' : 'zone_closed_or_hidden',
        conflict: null,
      };
    }

    const activeBookings = await this.getActiveBookingsForTable(table.id, dto.bookingDate);
    const conflict = this.findConflict(activeBookings, timeInfo.startMinutes, timeInfo.availableFromMinutes);
    const conflictInfo = conflict ? this.bookingToAvailabilityConflict(conflict) : null;

    return {
      tableId: table.id,
      tableNumber: table.tableNumber,
      bookingDate: dto.bookingDate,
      requestedFrom: timeInfo.bookingTime,
      requestedTo: timeInfo.departureTime,
      requestedAvailableFrom: timeInfo.availableFrom,
      requestedFromLabel: timeInfo.bookingTimeLabel,
      requestedToLabel: timeInfo.departureTimeLabel,
      requestedAvailableFromLabel: timeInfo.availableFromLabel,
      durationMinutes: timeInfo.durationMinutes,
      cleanupMinutes: timeInfo.cleanupMinutes,
      isAvailable: !conflict,
      reason: conflict ? 'time_conflict' : null,
      conflict: conflictInfo,
      nextAvailableFrom: conflictInfo?.availableFrom || null,
      nextAvailableFromLabel: conflictInfo?.availableFromLabel || null,
    };
  }

  async getTableStatuses(dto: Partial<CheckAvailabilityDto>) {
    const bookingDate = String(dto.bookingDate || '');
    const bookingTime = String(dto.bookingTime || '19:00');
    const timeInfo = this.buildTimeInfo(bookingTime, dto.durationMinutes);
    const today = this.restaurantDateToday();

    const tables = await this.tables.find({ relations: ['zone'], order: { tableNumber: 'ASC' } as any });

    const activeBookings = await this.bookings
      .createQueryBuilder('booking')
      .leftJoinAndSelect('booking.table', 'table')
      .leftJoinAndSelect('booking.client', 'client')
      .where('booking.bookingDate = :bookingDate', { bookingDate })
      .andWhere('booking.status IN (:...statuses)', { statuses: ACTIVE_BOOKING_STATUSES })
      .orderBy('booking.bookingTime', 'ASC')
      .getMany();

    const result: Record<string, unknown> = {};

    for (const table of tables) {
      const tableNumber = String(table.tableNumber);
      const tableBookings = activeBookings.filter(
        (booking) => booking.table?.id === table.id || String(booking.table?.tableNumber) === tableNumber,
      );
      const conflict = this.findConflict(tableBookings, timeInfo.startMinutes, timeInfo.availableFromMinutes);
      const conflictInfo = conflict ? this.bookingToAvailabilityConflict(conflict) : null;

      let status: TableEntity['status'] = 'free';
      let reason: string | null = null;

      if (!table.isVisible || table.zone?.isVisible === false) {
        status = 'closed';
        reason = 'hidden';
      } else if (table.status === 'closed' || table.zone?.isClosed) {
        status = 'closed';
        reason = 'closed';
      } else if (bookingDate === today && table.status === 'occupied') {
        status = 'occupied';
        reason = 'physical_status_today';
      } else if (bookingDate === today && table.status === 'cleaning') {
        status = 'cleaning';
        reason = 'physical_status_today';
      } else if (conflict) {
        status = conflict.status === 'pending' ? 'pending' : 'reserved';
        reason = 'booking_conflict';
      }

      result[tableNumber] = {
        tableId: table.id,
        tableNumber,
        status,
        reason,
        conflict: conflictInfo,
      };
    }

    return {
      bookingDate,
      bookingTime: timeInfo.bookingTime,
      durationMinutes: timeInfo.durationMinutes,
      cleanupMinutes: timeInfo.cleanupMinutes,
      requestedFrom: timeInfo.bookingTime,
      requestedTo: timeInfo.departureTime,
      requestedAvailableFrom: timeInfo.availableFrom,
      requestedFromLabel: timeInfo.bookingTimeLabel,
      requestedToLabel: timeInfo.departureTimeLabel,
      requestedAvailableFromLabel: timeInfo.availableFromLabel,
      today,
      statuses: result,
    };
  }

  async create(dto: CreateBookingDto) {
    try {
      await this.validateRestaurant();

      const guestDeviceIdHash = this.hashGuestDeviceId(dto.guestDeviceId);
      const guestPhoneNormalized = this.normalizePhone(dto.phone) || null;
      await this.assertNoActiveGuestBooking(dto.bookingDate, dto.phone, guestDeviceIdHash);

      const table = await this.resolveTableForBooking(dto);
      await this.assertTableCanBeBooked(table);

      let client = await this.clients.findOne({ where: { phone: dto.phone } });
      if (!client) client = await this.clients.save(this.clients.create({ fullName: dto.fullName, phone: dto.phone }));
      if (client.isBlacklisted) throw new BadRequestException('Бронювання з цього номера недоступне');

      const timeInfo = await this.assertNoTimeConflict(table.id, dto.bookingDate, dto.bookingTime, dto.durationMinutes);

      const originalWishes = dto.wishes || '';
      const wishesWithSystemTime = [
        `Час відпочинку: ${timeInfo.durationMinutes} хв (${timeInfo.bookingTimeLabel} — ${timeInfo.departureTimeLabel})`,
        `Підготовка столу після гостей: ${timeInfo.cleanupMinutes} хв, наступний гість з ${timeInfo.availableFromLabel}`,
        originalWishes,
      ].filter(Boolean).join('\n');

      const guestAccessToken = randomBytes(32).toString('hex');
      const guestAccessTokenHash = createHash('sha256').update(guestAccessToken).digest('hex');

      const booking = await this.bookings.save(
        this.bookings.create({
          table,
          client,
          guestAccessTokenHash,
          guestDeviceIdHash,
          guestPhoneNormalized,
          bookingDate: dto.bookingDate,
          bookingTime: timeInfo.bookingTime,
          durationMinutes: timeInfo.durationMinutes,
          guestsCount: dto.guestsCount,
          wishes: wishesWithSystemTime,
          status: 'pending',
          source: 'mini_app',
        }),
      );

      await this.saveHistory(booking, 'booking_created', 'guest', null, this.bookingSnapshot(booking));

      await this.setTableStatusOnlyForToday(table, 'pending', dto.bookingDate);
      await this.safeLog('Створено заявку на бронювання', {
        bookingId: booking.id,
        tableNumber: table.tableNumber,
        clientName: client.fullName,
        time: `${timeInfo.bookingTimeLabel} — ${timeInfo.departureTimeLabel}`,
        durationMinutes: timeInfo.durationMinutes,
      });

      await this.safeNotify(async () => {
        const full = await this.bookings.findOne({ where: { id: booking.id }, relations: ['table', 'client'] });
        if (full) await this.notifications.notifyNewBooking(full);
      });

      return {
        message: 'Заявку на бронювання надіслано адміністратору',
        bookingId: booking.id,
        guestAccessToken,
        status: booking.status,
        bookingTime: timeInfo.bookingTime,
        departureTime: timeInfo.departureTime,
        availableFrom: timeInfo.availableFrom,
        durationMinutes: timeInfo.durationMinutes,
        cleanupMinutes: timeInfo.cleanupMinutes,
      };
    } catch (error: any) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      if (
        (error?.code || error?.driverError?.code) === '23505' &&
        [
          'UQ_bookings_active_guest_device_date',
          'UQ_bookings_active_guest_phone_date',
        ].includes(error?.constraint || error?.driverError?.constraint)
      ) {
        throw new BadRequestException('На цю дату вже є активне бронювання з цього пристрою або номера телефону');
      }
      console.error('Booking create failed:', error);
      throw new BadRequestException(`Booking error: ${error?.message || 'unknown error'}`);
    }
  }

  async getPublicStatus(id: string) {
    const booking = await this.bookings.findOne({ where: { id }, relations: ['table', 'client'] });
    if (!booking) throw new NotFoundException('Бронювання не знайдено');

    return this.publicBookingStatusPayload(booking);
  }

  async getPendingReminders() {
    const threshold = new Date(Date.now() - PENDING_REMINDER_MINUTES * 60 * 1000);

    return this.bookings
      .createQueryBuilder('booking')
      .leftJoinAndSelect('booking.table', 'table')
      .leftJoinAndSelect('booking.client', 'client')
      .where('booking.status = :status', { status: 'pending' })
      .andWhere('booking.createdAt <= :threshold', { threshold })
      .orderBy('booking.createdAt', 'ASC')
      .take(100)
      .getMany();
  }

  private normalizeBookingDate(date?: string) {
    const value = String(date || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new BadRequestException('Невірний формат дати. Використовуйте YYYY-MM-DD');
    }

    const parsed = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
      throw new BadRequestException('Невірна дата бронювання');
    }

    return value;
  }

  async getByDate(date: string) {
    const bookingDate = this.normalizeBookingDate(date);

    return this.bookings.find({
      where: { bookingDate },
      relations: ['table', 'table.zone', 'client'],
      order: { bookingTime: 'ASC', createdAt: 'DESC' },
      take: 1000,
    });
  }

  async getToday() {
    return this.getByDate(this.restaurantDateToday());
  }

  async getArchive(date?: string, limit?: number) {
    const normalizedLimit = Math.min(1000, Math.max(1, Number(limit) || 300));

    const query = this.bookings
      .createQueryBuilder('booking')
      .leftJoinAndSelect('booking.table', 'table')
      .leftJoinAndSelect('table.zone', 'zone')
      .leftJoinAndSelect('booking.client', 'client')
      .where('booking.status IN (:...statuses)', {
        statuses: ['completed', 'cancelled', 'rejected'] as BookingStatus[],
      })
      .orderBy('booking.bookingDate', 'DESC')
      .addOrderBy('booking.bookingTime', 'DESC')
      .addOrderBy('booking.updatedAt', 'DESC')
      .take(normalizedLimit);

    if (date) {
      query.andWhere('booking.bookingDate = :bookingDate', {
        bookingDate: this.normalizeBookingDate(date),
      });
    }

    return query.getMany();
  }

  async getStats() {
    const today = this.restaurantDateToday();
    const overdueThreshold = new Date(Date.now() - PENDING_REMINDER_MINUTES * 60 * 1000);

    const [
      total,
      todayTotal,
      pendingToday,
      overduePendingToday,
      archivedTotal,
      occupiedTables,
      cleaningTables,
    ] = await Promise.all([
      this.bookings.count(),
      this.bookings.count({ where: { bookingDate: today } }),
      this.bookings.count({ where: { bookingDate: today, status: 'pending' } }),
      this.bookings
        .createQueryBuilder('booking')
        .where('booking.bookingDate = :today', { today })
        .andWhere('booking.status = :status', { status: 'pending' })
        .andWhere('booking.createdAt <= :threshold', { threshold: overdueThreshold })
        .getCount(),
      this.bookings
        .createQueryBuilder('booking')
        .where('booking.status IN (:...statuses)', {
          statuses: ['completed', 'cancelled', 'rejected'] as BookingStatus[],
        })
        .getCount(),
      this.tables.count({ where: { status: 'occupied' } }),
      this.tables.count({ where: { status: 'cleaning' } }),
    ]);

    return {
      today,
      total,
      todayTotal,
      pendingToday,
      overduePendingToday,
      archivedTotal,
      occupiedTables,
      cleaningTables,
      pendingReminderMinutes: PENDING_REMINDER_MINUTES,
    };
  }

  async approve(id: string) {
    const booking = await this.bookings.findOne({ where: { id }, relations: ['table', 'client'] });
    if (!booking) throw new NotFoundException('Бронювання не знайдено');

    const previousData = this.bookingSnapshot(booking);
    booking.status = 'approved';
    booking.approvedAt = new Date();
    await this.bookings.save(booking);
    await this.saveHistory(booking, 'booking_approved', 'admin', previousData, this.bookingSnapshot(booking));
    await this.setTableStatusOnlyForToday(booking.table, 'reserved', booking.bookingDate);
    await this.safeLog('Підтверджено бронювання', { bookingId: id });
    await this.safeNotify(() => this.notifications.notifyBookingApproved(booking));
    return { message: 'Бронювання підтверджено' };
  }

  async reject(id: string) {
    const booking = await this.bookings.findOne({ where: { id }, relations: ['table', 'client'] });
    if (!booking) throw new NotFoundException('Бронювання не знайдено');

    const previousData = this.bookingSnapshot(booking);
    booking.status = 'rejected';
    booking.rejectedAt = new Date();
    booking.cancellationReason = 'admin_rejected';
    await this.bookings.save(booking);
    await this.saveHistory(booking, 'booking_rejected', 'admin', previousData, this.bookingSnapshot(booking));
    await this.setTableStatusOnlyForToday(booking.table, 'free', booking.bookingDate);
    await this.safeLog('Відхилено бронювання', { bookingId: id });
    await this.safeNotify(() => this.notifications.notifyBookingCancelled(booking));
    return { message: 'Бронювання відхилено' };
  }

  async cancel(id: string) {
    const booking = await this.bookings.findOne({ where: { id }, relations: ['table', 'client'] });
    if (!booking) throw new NotFoundException('Бронювання не знайдено');

    const previousData = this.bookingSnapshot(booking);
    booking.status = 'cancelled';
    booking.cancelledAt = new Date();
    booking.cancellationReason = 'admin_cancelled';
    await this.bookings.save(booking);
    await this.saveHistory(booking, 'booking_cancelled', 'admin', previousData, this.bookingSnapshot(booking));
    await this.setTableStatusOnlyForToday(booking.table, 'free', booking.bookingDate);
    await this.safeLog('Скасовано бронювання', { bookingId: id });
    await this.safeNotify(() => this.notifications.notifyBookingCancelled(booking));
    return { message: 'Бронювання скасовано' };
  }

  async noShow(id: string) {
    const booking = await this.bookings.findOne({ where: { id }, relations: ['table', 'client'] });
    if (!booking) throw new NotFoundException('Бронювання не знайдено');

    if (booking.checkedInAt) {
      throw new BadRequestException('Гість уже відмічений як присутній');
    }

    const previousData = this.bookingSnapshot(booking);
    booking.status = 'cancelled';
    booking.cancelledAt = new Date();
    booking.cancellationReason = 'no_show';
    booking.wishes = this.markNoShowInWishes(booking);
    booking.guestNotification = {
      type: 'no_show',
      title: 'Бронювання завершено через неявку',
      createdAt: new Date().toISOString(),
    };
    await this.bookings.save(booking);
    await this.saveHistory(booking, 'booking_no_show', 'admin', previousData, this.bookingSnapshot(booking), 'no_show');
    await this.setTableStatusOnlyForToday(booking.table, 'free', booking.bookingDate);
    await this.safeLog('No-show: гість не прийшов', { bookingId: id, tableNumber: booking.table?.tableNumber || null });
    await this.safeNotify(() => this.notifications.notifyBookingCancelled(booking));
    return { message: 'Гість не прийшов. Бронювання знято, стіл вільний.' };
  }

  async checkIn(id: string) {
    const booking = await this.bookings.findOne({ where: { id }, relations: ['table', 'client'] });
    if (!booking) throw new NotFoundException('Бронювання не знайдено');

    const previousData = this.bookingSnapshot(booking);
    booking.status = 'approved';
    if (!booking.approvedAt) booking.approvedAt = new Date();
    if (!booking.checkedInAt) booking.checkedInAt = new Date();
    await this.bookings.save(booking);
    await this.saveHistory(booking, 'booking_checked_in', 'admin', previousData, this.bookingSnapshot(booking));
    await this.setTableStatusOnlyForToday(booking.table, 'occupied', booking.bookingDate, true);
    await this.safeLog('Гості прийшли', { bookingId: id });
    return { message: 'Гості відмічені як присутні' };
  }

  async complete(id: string) {
    const booking = await this.bookings.findOne({ where: { id }, relations: ['table', 'client'] });
    if (!booking) throw new NotFoundException('Бронювання не знайдено');

    const previousData = this.bookingSnapshot(booking);
    booking.status = 'completed';
    booking.completedAt = new Date();
    await this.bookings.save(booking);
    await this.saveHistory(booking, 'booking_completed', 'admin', previousData, this.bookingSnapshot(booking));
    await this.setTableStatusOnlyForToday(booking.table, 'free', booking.bookingDate, true);
    await this.safeLog('Стіл звільнено', { bookingId: id });
    return { message: 'Стіл звільнено' };
  }

  /** Moves an approved booking without carrying its check-in or waiter assignment state. */
  async waiterTransfer(id: string, tableId: string, actor: AuthUser) {
    if (!tableId) throw new BadRequestException('Оберіть новий стіл');

    const result = await this.bookings.manager.transaction(async (manager) => {
      const booking = await manager.getRepository(Booking).findOne({
        where: { id }, relations: ['table', 'client'], lock: { mode: 'pessimistic_write' },
      });
      if (!booking || booking.status !== 'approved' || !booking.table) {
        throw new BadRequestException('Пересадка доступна лише для підтвердженого бронювання');
      }
      const nextTable = await manager.getRepository(TableEntity).findOne({
        where: { id: tableId }, lock: { mode: 'pessimistic_write' },
      });
      if (!nextTable || !nextTable.isVisible || nextTable.status !== 'free') {
        throw new BadRequestException('Обраний стіл закритий або зайнятий');
      }
      if (nextTable.id === booking.table.id) throw new BadRequestException('Оберіть інший стіл');

      const availability = await this.checkAvailability({
        tableId: nextTable.id,
        bookingDate: booking.bookingDate,
        bookingTime: booking.bookingTime,
        durationMinutes: booking.durationMinutes,
      } as CheckAvailabilityDto);
      if (!availability.isAvailable) throw new BadRequestException('Цей стіл має конфлікт у часі бронювання');

      const oldTable = await manager.getRepository(TableEntity).findOne({
        where: { id: booking.table.id }, lock: { mode: 'pessimistic_write' },
      });
      if (!oldTable) throw new BadRequestException('Попередній стіл не знайдено');

      const previousData = this.bookingSnapshot(booking);
      const transferredBookingOwnsPhysicalStatus =
        Boolean(booking.checkedInAt) &&
        (oldTable.status === 'occupied' || oldTable.status === 'cleaning');
      booking.table = nextTable;
      booking.checkedInAt = null;
      await manager.getRepository(Booking).save(booking);
      if (booking.bookingDate === this.restaurantDateToday()) {
        // Фізичний occupied/cleaning може належати попередньому візиту за
        // послідовним бронюванням. Звільняємо його лише разом із гостями,
        // яких фактично пересаджують.
        if (
          oldTable.status !== 'closed' &&
          (transferredBookingOwnsPhysicalStatus || !['occupied', 'cleaning'].includes(oldTable.status))
        ) {
          oldTable.status = 'free';
        }
        nextTable.status = 'reserved';
        await manager.getRepository(TableEntity).save([oldTable, nextTable]);
      }
      await manager.getRepository(BookingHistory).save(manager.getRepository(BookingHistory).create({
        booking,
        action: 'waiter_table_transfer',
        actorRole: actor.role,
        actorStaffId: actor.staffId || null,
        actorName: actor.name || null,
        previousData,
        newData: this.bookingSnapshot(booking),
        reason: `Стіл №${oldTable.tableNumber} → №${nextTable.tableNumber}`,
        isManualMode: true,
      }));
      await this.safeLog('Пересадка гостей', { bookingId: booking.id, oldTable: oldTable.tableNumber, newTable: nextTable.tableNumber, author: actor.name || actor.staffId || null });
      return { message: 'Гостей пересаджено на новий стіл' };
    });

    // Waiter calls are in-memory, so invalidate them only after the database
    // transaction has committed the new table and booking state.
    this.waiterCalls.closeActiveCallsAndDetachBooking(id);
    return result;
  }

  async requestReschedule(id: string, dto: RequestRescheduleDto) {
    const booking = await this.bookings.findOne({ where: { id }, relations: ['table', 'client'] });
    if (!booking) throw new NotFoundException('Бронювання не знайдено');

    const request = await this.reschedules.save(
      this.reschedules.create({ booking, requestedDate: dto.requestedDate, requestedTime: dto.requestedTime }),
    );

    await this.safeNotify(() => this.notifications.notifyRescheduleRequest(request));
    return { message: 'Запит на перенесення надіслано', requestId: request.id };
  }

  async getPendingReschedules() {
    return this.reschedules.find({
      where: { status: 'pending' },
      relations: ['booking', 'booking.table', 'booking.client'],
      order: { createdAt: 'DESC' },
      take: 100,
    });
  }

  async approveReschedule(requestId: string) {
    const request = await this.reschedules.findOne({ where: { id: requestId }, relations: ['booking'] });
    if (!request) throw new NotFoundException('Запит не знайдено');

    request.status = 'approved';
    request.resolvedAt = new Date();
    request.booking.bookingDate = request.requestedDate;
    request.booking.bookingTime = request.requestedTime;
    await this.bookings.save(request.booking);
    await this.reschedules.save(request);
    return { message: 'Перенесення підтверджено' };
  }

  async rejectReschedule(requestId: string, dto: RejectRescheduleDto) {
    const request = await this.reschedules.findOne({ where: { id: requestId } });
    if (!request) throw new NotFoundException('Запит не знайдено');

    request.status = 'rejected';
    request.adminComment = dto.adminComment || null;
    request.resolvedAt = new Date();
    await this.reschedules.save(request);
    return { message: 'Перенесення відхилено' };
  }
}
