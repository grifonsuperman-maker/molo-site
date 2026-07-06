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
    const restaurants = await this.restaurants.find({
      order: { createdAt: 'ASC' },
      take: 1,
    });

    const r = restaurants[0];
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

  private async resolveTableForBooking(dto: CreateBookingDto) {
    let table: TableEntity | null = null;
    const tableId = String(dto.tableId || '');

    if (dto.tableId && !tableId.startsWith('visual-')) {
      table = await this.tables.findOne({ where: { id: dto.tableId }, relations: ['zone'] });
    }

    if (!table && dto.tableNumber) {
      table = await this.tables.findOne({
        where: { tableNumber: String(dto.tableNumber) },
        relations: ['zone'],
      });
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

      table = await this.tables.findOne({
        where: { id: table.id },
        relations: ['zone'],
      });
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

  async create(dto: CreateBookingDto) {
    try {
      await this.validateRestaurant();

      const table = await this.resolveTableForBooking(dto);
      await this.assertTableCanBeBooked(table);

      let client = await this.clients.findOne({ where: { phone: dto.phone } });

      if (!client) {
        client = await this.clients.save(this.clients.create({ fullName: dto.fullName, phone: dto.phone }));
      }

      if (client.isBlacklisted) throw new BadRequestException('Бронювання з цього номера недоступне');

      const timeInfo = await this.assertNoTimeConflict(
        table.id,
        dto.bookingDate,
        dto.bookingTime,
        dto.durationMinutes,
      );

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

      await this.setTableStatus(table, 'pending');

      try {
        await this.logs.create('Створено заявку на бронювання', null, {
          bookingId: booking.id,
          tableNumber: table.tableNumber,
          clientName: client.fullName,
          time: `${timeInfo.bookingTimeLabel} — ${timeInfo.departureTimeLabel}`,
          durationMinutes: timeInfo.durationMinutes,
        });
      } catch (error) {
        console.error('Booking log failed:', error);
      }

      try {
        const full = await this.bookings.findOne({
          where: { id: booking.id },
          relations: ['table', 'client'],
        });

        if (full) await this.notifications.notifyNewBooking(full);
      } catch (error) {
        console.error('Booking notification failed:', error);
      }

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
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }

      console.error('Booking create failed:', error);
      throw new BadRequestException(`Booking error: ${error?.message || 'unknown error'}`);
    }
  }

  async getToday() {
    return this.bookings.find({
      relations: ['table', 'client'],
      order: { createdAt: 'DESC' },
      take: 300,
    });
  }

  async approve(id: string) {
    const booking = await this.bookings.findOne({ where: { id }, relations: ['table', 'client'] });
    if (!booking) throw new NotFoundException('Бронювання не знайдено');
    booking.status = 'approved';
    booking.approvedAt = new Date();
    await this.bookings.save(booking);
    await this.setTableStatus(booking.table, 'reserved');
    await this.logs.create('Підтверджено бронювання', null, { bookingId: id });
    await this.notifications.notifyBookingApproved(booking);
    return { message: 'Бронювання підтверджено' };
  }

  async reject(id: string) {
    const booking = await this.bookings.findOne({ where: { id }, relations: ['table', 'client'] });
    if (!booking) throw new NotFoundException('Бронювання не знайдено');
    booking.status = 'rejected';
    booking.rejectedAt = new Date();
    await this.bookings.save(booking);
    await this.setTableStatus(booking.table, 'free');
    await this.logs.create('Відхилено бронювання', null, { bookingId: id });
    await this.notifications.notifyBookingCancelled(booking);
    return { message: 'Бронювання відхилено' };
  }

  async cancel(id: string) {
    const booking = await this.bookings.findOne({ where: { id }, relations: ['table', 'client'] });
    if (!booking) throw new NotFoundException('Бронювання не знайдено');
    booking.status = 'cancelled';
    booking.cancelledAt = new Date();
    await this.bookings.save(booking);
    await this.setTableStatus(booking.table, 'free');
    await this.logs.create('Скасовано бронювання', null, { bookingId: id });
    await this.notifications.notifyBookingCancelled(booking);
    return { message: 'Бронювання скасовано' };
  }

  async checkIn(id: string) {
    const booking = await this.bookings.findOne({ where: { id }, relations: ['table', 'client'] });
    if (!booking) throw new NotFoundException('Бронювання не знайдено');
    booking.status = 'approved';
    await this.bookings.save(booking);
    await this.setTableStatus(booking.table, 'occupied');
    await this.logs.create('Гості прийшли', null, { bookingId: id });
    return { message: 'Гості відмічені як присутні' };
  }

  async complete(id: string) {
    const booking = await this.bookings.findOne({ where: { id }, relations: ['table', 'client'] });
    if (!booking) throw new NotFoundException('Бронювання не знайдено');
    booking.status = 'completed';
    booking.completedAt = new Date();
    await this.bookings.save(booking);
    await this.setTableStatus(booking.table, 'free');
    await this.logs.create('Стіл звільнено', null, { bookingId: id });
    return { message: 'Стіл звільнено' };
  }

  async requestReschedule(id: string, dto: RequestRescheduleDto) {
    const booking = await this.bookings.findOne({ where: { id }, relations: ['table', 'client'] });
    if (!booking) throw new NotFoundException('Бронювання не знайдено');

    const request = await this.reschedules.save(
      this.reschedules.create({
        booking,
        requestedDate: dto.requestedDate,
        requestedTime: dto.requestedTime,
        reason: dto.reason || null,
      }),
    );

    await this.notifications.notifyRescheduleRequest(request);
    return { message: 'Запит на перенесення надіслано', requestId: request.id };
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
