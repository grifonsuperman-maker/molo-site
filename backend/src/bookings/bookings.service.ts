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
const ARRIVAL_GRACE_MINUTES = 15;
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
    const r = await this.restaurants.findOne({ order: { createdAt: 'ASC' } });
    if (!r) throw new NotFoundException('Ресторан не знайдено');
    return r;
  }

  async validateRestaurant() {
    const r = await this.restaurant();
    if (r.status === 'closed') throw new BadRequestException(r.closeMessage);
    if (r.status === 'booking_closed') throw new BadRequestException(r.bookingClosedMessage);
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

  private formatTimeLabel(time: string | null) {
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
    };
  }

  private buildArrivalGraceUntil(bookingDate: string, bookingTime: string) {
    const [year, month, day] = bookingDate.split('-').map(Number);
    const startMinutes = this.parseTimeToMinutes(bookingTime);
    const hours = Math.floor(startMinutes / 60);
    const minutes = startMinutes % 60;
    return new Date(year, month - 1, day, hours, minutes + ARRIVAL_GRACE_MINUTES, 0, 0);
  }

  private getBookingStartMinutes(booking: Booking) {
    return this.parseTimeToMinutes(booking.bookingTime);
  }

  private getBookingDepartureMinutes(booking: Booking) {
    const start = this.getBookingStartMinutes(booking);
    return start + this.normalizeDuration(booking.durationMinutes);
  }

  private getBookingAvailableFromMinutes(booking: Booking) {
    const cleanup = Number.isFinite(Number(booking.cleanupMinutes))
      ? Number(booking.cleanupMinutes)
      : DEFAULT_CLEANUP_MINUTES;

    return this.getBookingDepartureMinutes(booking) + cleanup;
  }

  private bookingToAvailabilityConflict(booking: Booking) {
    const startMinutes = this.getBookingStartMinutes(booking);
    const departureMinutes = this.getBookingDepartureMinutes(booking);
    const availableFromMinutes = this.getBookingAvailableFromMinutes(booking);

    const bookedFrom = booking.bookingTime || this.formatTimeFromMinutes(startMinutes);
    const bookedTo = booking.departureTime || this.formatTimeFromMinutes(departureMinutes);
    const availableFrom = booking.availableFrom || this.formatTimeFromMinutes(availableFromMinutes);

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

    if (excludeBookingId) {
      query.andWhere('booking.id != :excludeBookingId', { excludeBookingId });
    }

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
        requestedFromLabel: this.formatTimeLabel(timeInfo.bookingTime),
        requestedToLabel: this.formatTimeLabel(timeInfo.departureTime),
        requestedAvailableFromLabel: this.formatTimeLabel(timeInfo.availableFrom),
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
      requestedFromLabel: this.formatTimeLabel(timeInfo.bookingTime),
      requestedToLabel: this.formatTimeLabel(timeInfo.departureTime),
      requestedAvailableFromLabel: this.formatTimeLabel(timeInfo.availableFrom),
      durationMinutes: timeInfo.durationMinutes,
      cleanupMinutes: timeInfo.cleanupMinutes,
      isAvailable: !conflict,
      reason: conflict ? 'time_conflict' : null,
      conflict: conflictInfo,
      nextAvailableFrom: conflictInfo?.availableFrom || null,
      nextAvailableFromLabel: conflictInfo?.availableFromLabel || null,
    };
  }

  async create(dto: CreateBookingDto) {
    await this.validateRestaurant();

    const table = await this.tables.findOne({ where: { id: dto.tableId }, relations: ['zone'] });
    if (!table) throw new NotFoundException('Стіл не знайдено');

    await this.assertTableCanBeBooked(table);

    let client = await this.clients.findOne({ where: { phone: dto.phone } });

    if (!client) {
      client = await this.clients.save(this.clients.create({ fullName: dto.fullName, phone: dto.phone }));
    }

    if (client.isBlacklisted) throw new BadRequestException('Бронювання з цього номера недоступне');

    const timeInfo = await this.assertNoTimeConflict(table.id, dto.bookingDate, dto.bookingTime, dto.durationMinutes);

    const booking = await this.bookings.save(
      this.bookings.create({
        table,
        client,
        bookingDate: dto.bookingDate,
        bookingTime: timeInfo.bookingTime,
        durationMinutes: timeInfo.durationMinutes,
        departureTime: timeInfo.departureTime,
        cleanupMinutes: timeInfo.cleanupMinutes,
        availableFrom: timeInfo.availableFrom,
        arrivalGraceUntil: this.buildArrivalGraceUntil(dto.bookingDate, timeInfo.bookingTime),
        guestsCount: dto.guestsCount,
        wishes: dto.wishes || null,
        status: 'pending',
        source: 'mini_app',
      }),
    );

    await this.logs.create('Створено заявку на бронювання', null, {
      bookingId: booking.id,
      tableNumber: table.tableNumber,
      clientName: client.fullName,
      time: `${this.formatTimeLabel(booking.bookingTime)} — ${this.formatTimeLabel(booking.departureTime)}`,
      durationMinutes: booking.durationMinutes,
    });

    const full = await this.bookings.findOne({
      where: { id: booking.id },
      relations: ['table', 'client'],
    });

    if (full) await this.notifications.notifyNewBooking(full);

    return {
      message: 'Заявку на бронювання надіслано адміністратору',
      bookingId: booking.id,
      status: booking.status,
      bookingTime: booking.bookingTime,
      departureTime: booking.departureTime,
      availableFrom: booking.availableFrom,
      durationMinutes: booking.durationMinutes,
      cleanupMinutes: booking.cleanupMinutes,
    };
  }

  async getToday() {
    const today = new Date().toISOString().slice(0, 10);

    return this.bookings.find({
      where: { bookingDate: today },
      relations: ['table', 'client'],
      order: { bookingTime: 'ASC' },
    });
  }

  async getBooking(id: string) {
    const b = await this.bookings.findOne({
      where: { id },
      relations: ['table', 'client'],
    });

    if (!b) throw new NotFoundException('Бронювання не знайдено');
    return b;
  }

  async approve(id: string) {
    const b = await this.getBooking(id);

    if (!b.table) throw new BadRequestException('Стіл не знайдено');
    if (b.status !== 'pending') throw new BadRequestException('Це бронювання вже оброблено');

    await this.assertNoTimeConflict(b.table.id, b.bookingDate, b.bookingTime, b.durationMinutes, b.id);

    b.status = 'approved';
    b.approvedAt = new Date();
    b.table.status = 'reserved';

    await this.tables.save(b.table);
    await this.bookings.save(b);
    await this.logs.create('Бронювання підтверджено', null, { bookingId: b.id });
    await this.notifications.notifyBookingApproved(b);

    return { message: 'Бронювання підтверджено' };
  }

  async reject(id: string) {
    const b = await this.getBooking(id);

    if (b.status !== 'pending') throw new BadRequestException('Це бронювання вже оброблено');

    b.status = 'rejected';
    b.rejectedAt = new Date();

    await this.bookings.save(b);
    await this.logs.create('Бронювання відхилено', null, { bookingId: b.id });

    return { message: 'Бронювання відхилено' };
  }

  async cancel(id: string) {
    const b = await this.getBooking(id);

    b.status = 'cancelled';
    b.cancelledAt = new Date();
    b.cancelReason = 'admin_cancelled';

    if (b.table?.status === 'reserved') {
      b.table.status = 'free';
      await this.tables.save(b.table);
    }

    if (b.client) {
      b.client.cancellationsCount += 1;
      await this.clients.save(b.client);
    }

    await this.bookings.save(b);
    await this.logs.create('Бронювання скасовано', null, { bookingId: b.id });
    await this.notifications.notifyBookingCancelled(b);

    return { message: 'Бронювання скасовано' };
  }

  async checkIn(id: string) {
    const b = await this.getBooking(id);

    if (!b.table) throw new BadRequestException('Стіл не знайдено');
    if (b.status !== 'approved') throw new BadRequestException('Посадити можна тільки підтверджене бронювання');

    b.checkedInAt = new Date();
    b.table.status = 'occupied';

    if (b.client) {
      b.client.visitsCount += 1;
      b.client.totalGuests += b.guestsCount;
      b.client.lastVisitAt = new Date();
      await this.clients.save(b.client);
    }

    await this.tables.save(b.table);
    await this.bookings.save(b);
    await this.logs.create('Гості прийшли', null, { bookingId: b.id });

    return { message: 'Гості прийшли, стіл зайнятий' };
  }

  async complete(id: string) {
    const b = await this.getBooking(id);

    if (!b.table) throw new BadRequestException('Стіл не знайдено');

    b.status = 'completed';
    b.completedAt = new Date();
    b.table.status = 'free';

    await this.tables.save(b.table);
    await this.bookings.save(b);
    await this.logs.create('Стіл звільнено', null, { bookingId: b.id });

    return { message: 'Стіл вільний' };
  }

  async requestReschedule(id: string, dto: RequestRescheduleDto) {
    const b = await this.getBooking(id);

    if (!['pending', 'approved'].includes(b.status)) {
      throw new BadRequestException('Для цього бронювання не можна запросити перенесення');
    }

    const r = await this.reschedules.save(
      this.reschedules.create({
        booking: b,
        requestedDate: dto.requestedDate,
        requestedTime: dto.requestedTime,
        status: 'pending',
      }),
    );

    if (b.client) {
      b.client.reschedulesCount += 1;
      await this.clients.save(b.client);
    }

    const full = await this.reschedules.findOne({
      where: { id: r.id },
      relations: ['booking', 'booking.table', 'booking.client'],
    });

    if (full) await this.notifications.notifyRescheduleRequest(full);

    await this.logs.create('Гість запросив перенесення бронювання', null, {
      bookingId: b.id,
      requestId: r.id,
    });

    return {
      message: 'Запит на перенесення надіслано адміністратору',
      requestId: r.id,
    };
  }

  async getPendingReschedules() {
    return this.reschedules.find({
      where: { status: 'pending' },
      relations: ['booking', 'booking.table', 'booking.client'],
      order: { createdAt: 'DESC' },
    });
  }

  async approveReschedule(requestId: string) {
    const r = await this.reschedules.findOne({
      where: { id: requestId },
      relations: ['booking', 'booking.table', 'booking.client'],
    });

    if (!r) throw new NotFoundException('Запит на перенесення не знайдено');
    if (r.status !== 'pending') throw new BadRequestException('Цей запит уже оброблено');
    if (!r.booking.table) throw new BadRequestException('Стіл не знайдено');

    const timeInfo = await this.assertNoTimeConflict(
      r.booking.table.id,
      r.requestedDate,
      r.requestedTime,
      r.booking.durationMinutes,
      r.booking.id,
    );

    r.booking.bookingDate = r.requestedDate;
    r.booking.bookingTime = timeInfo.bookingTime;
    r.booking.departureTime = timeInfo.departureTime;
    r.booking.cleanupMinutes = timeInfo.cleanupMinutes;
    r.booking.availableFrom = timeInfo.availableFrom;
    r.booking.arrivalGraceUntil = this.buildArrivalGraceUntil(r.requestedDate, timeInfo.bookingTime);

    r.status = 'approved';
    r.resolvedAt = new Date();

    await this.bookings.save(r.booking);
    await this.reschedules.save(r);
    await this.logs.create('Перенесення бронювання підтверджено', null, { requestId: r.id });

    return { message: 'Перенесення бронювання підтверджено' };
  }

  async rejectReschedule(requestId: string, dto: RejectRescheduleDto) {
    const r = await this.reschedules.findOne({
      where: { id: requestId },
      relations: ['booking'],
    });

    if (!r) throw new NotFoundException('Запит на перенесення не знайдено');

    r.status = 'rejected';
    r.adminComment = dto.adminComment || null;
    r.resolvedAt = new Date();

    await this.reschedules.save(r);
    await this.logs.create('Перенесення бронювання відхилено', null, { requestId: r.id });

    return { message: 'Перенесення бронювання відхилено' };
  }
}
