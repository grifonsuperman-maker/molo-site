import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Booking, BookingStatus } from './entities/booking.entity';
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

const DEFAULT_DURATION_MINUTES = 120;
const DEFAULT_CLEANUP_MINUTES = 15;
const ACTIVE_BOOKING_STATUSES: BookingStatus[] = ['pending', 'approved'];

@Injectable()
export class BookingsService {
  constructor(
    @InjectRepository(Booking) private readonly bookings: Repository<Booking>,
    @InjectRepository(BookingRescheduleRequest) private readonly reschedules: Repository<BookingRescheduleRequest>,
    @InjectRepository(Client) private readonly clients: Repository<Client>,
    @InjectRepository(TableEntity) private readonly tables: Repository<TableEntity>,
    @InjectRepository(Restaurant) private readonly restaurants: Repository<Restaurant>,
    private readonly logs: LogsService,
    private readonly notifications: NotificationsService,
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
  ) {
    if (!table) return;

    // Важливо: майбутня бронь не повинна фарбувати стіл сьогодні.
    // Статус table.status — це фізичний статус столу зараз, а не всі майбутні броні.
    if (!this.isBookingToday(bookingDate)) return;

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

  private markNoShowInWishes(booking: Booking) {
    const current = booking.wishes || '';
    if (current.includes('[NO_SHOW]')) return current;
    return [current, `[NO_SHOW] Гість не прийшов. Бронь знято адміністратором ${new Date().toISOString()}.`]
      .filter(Boolean)
      .join('\n');
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
      } else if (conflict) {
        status = conflict.status === 'pending' ? 'pending' : 'reserved';
        reason = 'booking_conflict';
      } else if (bookingDate === today && (table.status === 'occupied' || table.status === 'cleaning')) {
        status = table.status;
        reason = 'physical_status_today';
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

      const booking = await this.bookings.save(
        this.bookings.create({
          table,
          client,
          bookingDate: dto.bookingDate,
          bookingTime: timeInfo.bookingTime,
          guestsCount: dto.guestsCount,
          wishes: wishesWithSystemTime,
          status: 'pending',
          source: 'mini_app',
        }),
      );

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
        status: booking.status,
        bookingTime: timeInfo.bookingTime,
        departureTime: timeInfo.departureTime,
        availableFrom: timeInfo.availableFrom,
        durationMinutes: timeInfo.durationMinutes,
        cleanupMinutes: timeInfo.cleanupMinutes,
      };
    } catch (error: any) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      console.error('Booking create failed:', error);
      throw new BadRequestException(`Booking error: ${error?.message || 'unknown error'}`);
    }
  }

  async getToday() {
    return this.bookings.find({ relations: ['table', 'client'], order: { createdAt: 'DESC' }, take: 300 });
  }

  async approve(id: string) {
    const booking = await this.bookings.findOne({ where: { id }, relations: ['table', 'client'] });
    if (!booking) throw new NotFoundException('Бронювання не знайдено');

    booking.status = 'approved';
    booking.approvedAt = new Date();
    await this.bookings.save(booking);
    await this.setTableStatusOnlyForToday(booking.table, 'reserved', booking.bookingDate);
    await this.safeLog('Підтверджено бронювання', { bookingId: id });
    await this.safeNotify(() => this.notifications.notifyBookingApproved(booking));
    return { message: 'Бронювання підтверджено' };
  }

  async reject(id: string) {
    const booking = await this.bookings.findOne({ where: { id }, relations: ['table', 'client'] });
    if (!booking) throw new NotFoundException('Бронювання не знайдено');

    booking.status = 'rejected';
    booking.rejectedAt = new Date();
    await this.bookings.save(booking);
    await this.setTableStatusOnlyForToday(booking.table, 'free', booking.bookingDate);
    await this.safeLog('Відхилено бронювання', { bookingId: id });
    await this.safeNotify(() => this.notifications.notifyBookingCancelled(booking));
    return { message: 'Бронювання відхилено' };
  }

  async cancel(id: string) {
    const booking = await this.bookings.findOne({ where: { id }, relations: ['table', 'client'] });
    if (!booking) throw new NotFoundException('Бронювання не знайдено');

    booking.status = 'cancelled';
    booking.cancelledAt = new Date();
    await this.bookings.save(booking);
    await this.setTableStatusOnlyForToday(booking.table, 'free', booking.bookingDate);
    await this.safeLog('Скасовано бронювання', { bookingId: id });
    await this.safeNotify(() => this.notifications.notifyBookingCancelled(booking));
    return { message: 'Бронювання скасовано' };
  }

  async noShow(id: string) {
    const booking = await this.bookings.findOne({ where: { id }, relations: ['table', 'client'] });
    if (!booking) throw new NotFoundException('Бронювання не знайдено');

    booking.status = 'cancelled';
    booking.cancelledAt = new Date();
    booking.wishes = this.markNoShowInWishes(booking);
    await this.bookings.save(booking);
    await this.setTableStatusOnlyForToday(booking.table, 'free', booking.bookingDate);
    await this.safeLog('No-show: гість не прийшов', { bookingId: id, tableNumber: booking.table?.tableNumber || null });
    await this.safeNotify(() => this.notifications.notifyBookingCancelled(booking));
    return { message: 'Гість не прийшов. Бронювання знято, стіл вільний.' };
  }

  async checkIn(id: string) {
    const booking = await this.bookings.findOne({ where: { id }, relations: ['table', 'client'] });
    if (!booking) throw new NotFoundException('Бронювання не знайдено');

    booking.status = 'approved';
    if (!booking.approvedAt) booking.approvedAt = new Date();
    await this.bookings.save(booking);
    await this.setTableStatusOnlyForToday(booking.table, 'occupied', booking.bookingDate);
    await this.safeLog('Гості прийшли', { bookingId: id });
    return { message: 'Гості відмічені як присутні' };
  }

  async complete(id: string) {
    const booking = await this.bookings.findOne({ where: { id }, relations: ['table', 'client'] });
    if (!booking) throw new NotFoundException('Бронювання не знайдено');

    booking.status = 'completed';
    booking.completedAt = new Date();
    await this.bookings.save(booking);
    await this.setTableStatusOnlyForToday(booking.table, 'free', booking.bookingDate);
    await this.safeLog('Стіл звільнено', { bookingId: id });
    return { message: 'Стіл звільнено' };
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
