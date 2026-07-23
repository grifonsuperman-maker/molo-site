import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';

import { Client } from '../clients/entities/client.entity';
import { LogsService } from '../logs/logs.service';
import { TableEntity, TableStatus } from '../tables/entities/table.entity';
import { AdminChangeTableDto } from './dto/admin-change-table.dto';
import { CreateAdminBookingDto } from './dto/create-admin-booking.dto';
import { BookingHistory } from './entities/booking-history.entity';
import { Booking, BookingStatus } from './entities/booking.entity';

const ACTIVE_STATUSES: BookingStatus[] = ['pending', 'approved'];
const DEFAULT_DURATION_MINUTES = 120;
const CLEANUP_MINUTES = 15;
const KYIV_TIME_ZONE = 'Europe/Kyiv';

@Injectable()
export class AdminBookingsService {
  constructor(
    @InjectRepository(Booking)
    private readonly bookings: Repository<Booking>,
    private readonly dataSource: DataSource,
    private readonly logs: LogsService,
  ) {}

  async createManual(dto: CreateAdminBookingDto) {
    try {
      const bookingId = await this.dataSource.transaction(async (manager) => {
        const bookingDate = this.normalizeDate(dto.bookingDate);
        const phoneNormalized = this.normalizePhone(dto.phone);
        if (!phoneNormalized) {
          throw new BadRequestException('Вкажіть коректний номер телефону');
        }

        const table = await this.resolveTable(manager, dto.tableId, dto.tableNumber);
        this.assertTableAvailable(table, bookingDate, Number(dto.guestsCount));

        const clientRepository = manager.getRepository(Client);
        const existingClients = await clientRepository.find();
        let client = existingClients.find(
          (candidate) => this.normalizePhone(candidate.phone) === phoneNormalized,
        );

        if (client?.isBlacklisted) {
          throw new BadRequestException('Клієнт у чорному списку. Бронювання недоступне.');
        }

        if (!client) {
          client = clientRepository.create({
            fullName: String(dto.fullName).trim(),
            phone: String(dto.phone).trim(),
          });
        } else {
          client.fullName = String(dto.fullName).trim() || client.fullName;
        }
        client = await clientRepository.save(client);

        const duplicateBookings = await manager
          .getRepository(Booking)
          .createQueryBuilder('booking')
          .leftJoinAndSelect('booking.client', 'client')
          .where('booking.bookingDate = :bookingDate', { bookingDate })
          .andWhere('booking.status IN (:...statuses)', { statuses: ACTIVE_STATUSES })
          .getMany();

        const duplicate = duplicateBookings.some(
          (booking) => this.normalizePhone(booking.client?.phone) === phoneNormalized,
        );
        if (duplicate) {
          throw new ConflictException('На цю дату вже є активне бронювання з цього номера телефону');
        }

        const timeInfo = await this.assertNoConflict(
          manager,
          table.id,
          bookingDate,
          dto.bookingTime,
          dto.durationMinutes,
        );

        const wishes = [
          `Час відпочинку: ${timeInfo.durationMinutes} хв (${timeInfo.fromLabel} — ${timeInfo.toLabel})`,
          `Підготовка столу після гостей: ${CLEANUP_MINUTES} хв, наступний гість з ${timeInfo.availableFromLabel}`,
          String(dto.wishes || '').trim(),
        ]
          .filter(Boolean)
          .join('\n');

        const bookingRepository = manager.getRepository(Booking);
        const booking = await bookingRepository.save(
          bookingRepository.create({
            table,
            client,
            guestAccessTokenHash: null,
            guestDeviceIdHash: null,
            guestPhoneNormalized: phoneNormalized,
            bookingDate,
            bookingTime: timeInfo.bookingTime,
            durationMinutes: timeInfo.durationMinutes,
            guestsCount: Number(dto.guestsCount),
            wishes,
            status: 'approved',
            source: 'admin_manual',
            approvedAt: new Date(),
          }),
        );

        await this.saveHistory(manager, booking, 'admin_manual_booking_created', null, this.snapshot(booking));
        await this.applyBookingTableStatus(manager, booking, table);
        return booking.id;
      });

      await this.safeLog('Адміністратор створив бронювання телефоном', { bookingId });
      return this.findBooking(bookingId);
    } catch (error: any) {
      if (
        error instanceof BadRequestException ||
        error instanceof ConflictException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }

      if ((error?.code || error?.driverError?.code) === '23505') {
        throw new ConflictException('На цю дату вже є активне бронювання з цього номера телефону');
      }

      throw new BadRequestException(error?.message || 'Не вдалося створити бронювання телефоном');
    }
  }

  async changeTable(bookingId: string, dto: AdminChangeTableDto) {
    const result = await this.dataSource.transaction(async (manager) => {
      const bookingRepository = manager.getRepository(Booking);
      const booking = await bookingRepository
        .createQueryBuilder('booking')
        .leftJoinAndSelect('booking.table', 'table')
        .leftJoinAndSelect('booking.client', 'client')
        .where('booking.id = :bookingId', { bookingId })
        .setLock('pessimistic_write')
        .getOne();

      if (!booking) throw new NotFoundException('Бронювання не знайдено');
      if (!ACTIVE_STATUSES.includes(booking.status)) {
        throw new BadRequestException('Змінити стіл можна лише для активного бронювання');
      }

      const newTable = await this.resolveTable(manager, dto.tableId);
      if (booking.table?.id === newTable.id) {
        return { bookingId: booking.id, oldTableNumber: newTable.tableNumber, newTableNumber: newTable.tableNumber };
      }

      this.assertTableAvailable(newTable, booking.bookingDate, Number(booking.guestsCount));
      await this.assertNoConflict(
        manager,
        newTable.id,
        booking.bookingDate,
        booking.bookingTime,
        booking.durationMinutes || undefined,
        booking.id,
      );

      const oldTable = booking.table;
      const previousData = this.snapshot(booking);
      booking.table = newTable;
      booking.guestNotification = {
        type: 'manual_change',
        title: 'Адміністратор змінив стіл',
        message: `Новий стіл №${newTable.tableNumber}`,
        previousTableNumber: oldTable?.tableNumber || null,
        newTableNumber: newTable.tableNumber,
        createdAt: new Date().toISOString(),
      };
      await bookingRepository.save(booking);

      await this.saveHistory(
        manager,
        booking,
        'admin_changed_table',
        previousData,
        this.snapshot(booking),
        `Стіл №${oldTable?.tableNumber || '-'} → №${newTable.tableNumber}`,
      );

      if (oldTable) await this.synchronizeOldTable(manager, oldTable, booking);
      await this.applyBookingTableStatus(manager, booking, newTable);

      return {
        bookingId: booking.id,
        oldTableNumber: oldTable?.tableNumber || null,
        newTableNumber: newTable.tableNumber,
      };
    });

    await this.safeLog('Адміністратор змінив стіл бронювання', result);
    return {
      message: `Стіл змінено на №${result.newTableNumber}`,
      booking: await this.findBooking(result.bookingId),
    };
  }

  async upcoming(daysRaw?: number) {
    const days = Math.min(366, Math.max(1, Number(daysRaw) || 180));
    const today = this.kyivDate();
    const endDate = this.addDays(today, days - 1);

    const bookings = await this.bookings
      .createQueryBuilder('booking')
      .where('booking.bookingDate BETWEEN :today AND :endDate', { today, endDate })
      .andWhere('booking.status IN (:...statuses)', { statuses: ACTIVE_STATUSES })
      .orderBy('booking.bookingDate', 'ASC')
      .addOrderBy('booking.bookingTime', 'ASC')
      .getMany();

    const grouped = new Map<string, { date: string; total: number; pending: number; approved: number; guests: number }>();
    for (const booking of bookings) {
      const current = grouped.get(booking.bookingDate) || {
        date: booking.bookingDate,
        total: 0,
        pending: 0,
        approved: 0,
        guests: 0,
      };
      current.total += 1;
      current.pending += booking.status === 'pending' ? 1 : 0;
      current.approved += booking.status === 'approved' ? 1 : 0;
      current.guests += Number(booking.guestsCount || 0);
      grouped.set(booking.bookingDate, current);
    }

    return {
      today,
      endDate,
      days,
      total: bookings.length,
      pending: bookings.filter((booking) => booking.status === 'pending').length,
      approved: bookings.filter((booking) => booking.status === 'approved').length,
      dates: Array.from(grouped.values()),
    };
  }

  private async findBooking(id: string) {
    const booking = await this.bookings.findOne({
      where: { id },
      relations: ['table', 'table.zone', 'client'],
    });
    if (!booking) throw new NotFoundException('Бронювання не знайдено');
    return booking;
  }

  private async resolveTable(manager: EntityManager, tableId?: string, tableNumber?: string) {
    const id = String(tableId || '').trim();
    const number = String(tableNumber || '').trim();
    if (!id && !number) throw new BadRequestException('Оберіть стіл');

    let query = manager
      .getRepository(TableEntity)
      .createQueryBuilder('table')
      .leftJoinAndSelect('table.zone', 'zone')
      .setLock('pessimistic_write');

    query = id
      ? query.where('table.id = :id', { id })
      : query.where('table.tableNumber = :number', { number });

    const table = await query.getOne();
    if (!table) throw new NotFoundException('Стіл не знайдено');
    return table;
  }

  private assertTableAvailable(table: TableEntity, bookingDate: string, guestsCount: number) {
    if (!table.isVisible || table.zone?.isVisible === false) {
      throw new BadRequestException('Стіл прихований і недоступний');
    }
    if (table.status === 'closed' || table.zone?.isClosed) {
      throw new BadRequestException('Стіл або локація закриті');
    }
    if (Number(table.seats) < guestsCount) {
      throw new BadRequestException('Для цієї кількості гостей потрібен більший стіл');
    }
    if (
      bookingDate === this.kyivDate() &&
      (table.status === 'occupied' || table.status === 'cleaning')
    ) {
      throw new BadRequestException('Стіл зараз зайнятий або готується');
    }
  }

  private async assertNoConflict(
    manager: EntityManager,
    tableId: string,
    bookingDate: string,
    bookingTime: string,
    durationMinutes?: number,
    excludeBookingId?: string,
  ) {
    const timeInfo = this.timeInfo(bookingTime, durationMinutes);
    const query = manager
      .getRepository(Booking)
      .createQueryBuilder('booking')
      .leftJoin('booking.table', 'table')
      .where('table.id = :tableId', { tableId })
      .andWhere('booking.bookingDate = :bookingDate', { bookingDate })
      .andWhere('booking.status IN (:...statuses)', { statuses: ACTIVE_STATUSES });

    if (excludeBookingId) {
      query.andWhere('booking.id != :excludeBookingId', { excludeBookingId });
    }

    const candidates = await query.getMany();
    const conflict = candidates.find((candidate) => {
      const start = this.timeToMinutes(candidate.bookingTime);
      const availableFrom = start + this.bookingDuration(candidate) + CLEANUP_MINUTES;
      return timeInfo.startMinutes < availableFrom && timeInfo.availableFromMinutes > start;
    });

    if (conflict) {
      const from = this.timeLabel(conflict.bookingTime);
      const to = this.minutesToLabel(
        this.timeToMinutes(conflict.bookingTime) + this.bookingDuration(conflict),
      );
      throw new ConflictException(`Стіл уже заброньований ${from} — ${to}`);
    }

    return timeInfo;
  }

  private async applyBookingTableStatus(
    manager: EntityManager,
    booking: Booking,
    table: TableEntity,
  ) {
    if (booking.bookingDate !== this.kyivDate() || table.status === 'closed') return;

    const nextStatus: TableStatus = booking.checkedInAt
      ? 'occupied'
      : booking.status === 'pending'
        ? 'pending'
        : 'reserved';

    table.status = nextStatus;
    await manager.getRepository(TableEntity).save(table);
  }

  private async synchronizeOldTable(
    manager: EntityManager,
    oldTable: TableEntity,
    movedBooking: Booking,
  ) {
    if (movedBooking.bookingDate !== this.kyivDate() || oldTable.status === 'closed') return;

    const remaining = await manager
      .getRepository(Booking)
      .createQueryBuilder('booking')
      .leftJoin('booking.table', 'table')
      .where('table.id = :tableId', { tableId: oldTable.id })
      .andWhere('booking.bookingDate = :bookingDate', { bookingDate: movedBooking.bookingDate })
      .andWhere('booking.status IN (:...statuses)', { statuses: ACTIVE_STATUSES })
      .getMany();

    const nextStatus: TableStatus = remaining.some((booking) => Boolean(booking.checkedInAt))
      ? 'occupied'
      : remaining.some((booking) => booking.status === 'approved')
        ? 'reserved'
        : remaining.some((booking) => booking.status === 'pending')
          ? 'pending'
          : 'free';

    const physicalStatusMayBeUnrelated =
      !movedBooking.checkedInAt &&
      (oldTable.status === 'occupied' || oldTable.status === 'cleaning');
    if (physicalStatusMayBeUnrelated) return;

    oldTable.status = nextStatus;
    await manager.getRepository(TableEntity).save(oldTable);
  }

  private async saveHistory(
    manager: EntityManager,
    booking: Booking,
    action: string,
    previousData: Record<string, unknown> | null,
    newData: Record<string, unknown> | null,
    reason?: string,
  ) {
    const repository = manager.getRepository(BookingHistory);
    await repository.save(
      repository.create({
        booking,
        action,
        actorRole: 'admin',
        actorStaffId: null,
        actorName: null,
        previousData,
        newData,
        reason: reason || null,
        isManualMode: true,
      }),
    );
  }

  private snapshot(booking: Booking) {
    return {
      status: booking.status,
      source: booking.source,
      tableId: booking.table?.id || null,
      tableNumber: booking.table?.tableNumber || null,
      bookingDate: booking.bookingDate,
      bookingTime: booking.bookingTime,
      durationMinutes: booking.durationMinutes,
      guestsCount: booking.guestsCount,
      checkedInAt: booking.checkedInAt,
    };
  }

  private timeInfo(value: string, durationRaw?: number) {
    const startMinutes = this.timeToMinutes(value);
    const durationMinutes = this.normalizeDuration(durationRaw);
    const toMinutes = startMinutes + durationMinutes;
    const availableFromMinutes = toMinutes + CLEANUP_MINUTES;
    return {
      startMinutes,
      durationMinutes,
      availableFromMinutes,
      bookingTime: this.minutesToTime(startMinutes),
      fromLabel: this.minutesToLabel(startMinutes),
      toLabel: this.minutesToLabel(toMinutes),
      availableFromLabel: this.minutesToLabel(availableFromMinutes),
    };
  }

  private bookingDuration(booking: Booking) {
    const stored = Number(booking.durationMinutes);
    if (Number.isFinite(stored) && stored >= 30) return this.normalizeDuration(stored);

    const match = String(booking.wishes || '').match(/\((\d{2}:\d{2})\s*[—-]\s*(\d{2}:\d{2})\)/);
    if (!match) return DEFAULT_DURATION_MINUTES;
    const start = this.timeToMinutes(match[1]);
    const end = this.timeToMinutes(match[2]);
    return this.normalizeDuration(end >= start ? end - start : end + 1440 - start);
  }

  private normalizeDuration(value?: number) {
    const duration = Number(value || DEFAULT_DURATION_MINUTES);
    if (!Number.isFinite(duration)) return DEFAULT_DURATION_MINUTES;
    return Math.min(720, Math.max(30, Math.round(duration)));
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

  private minutesToTime(value: number) {
    const normalized = ((Math.round(value) % 1440) + 1440) % 1440;
    const hours = Math.floor(normalized / 60);
    const minutes = normalized % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;
  }

  private minutesToLabel(value: number) {
    return this.minutesToTime(value).slice(0, 5);
  }

  private timeLabel(value: string) {
    return String(value || '').slice(0, 5) || '-';
  }

  private normalizePhone(value: string | null | undefined) {
    return String(value || '').replace(/\D/g, '');
  }

  private normalizeDate(value: string) {
    const date = String(value || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BadRequestException('Невірний формат дати');
    }
    const parsed = new Date(`${date}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
      throw new BadRequestException('Невірна дата');
    }
    return date;
  }

  private kyivDate() {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: KYIV_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    const year = parts.find((part) => part.type === 'year')?.value || '1970';
    const month = parts.find((part) => part.type === 'month')?.value || '01';
    const day = parts.find((part) => part.type === 'day')?.value || '01';
    return `${year}-${month}-${day}`;
  }

  private addDays(date: string, amount: number) {
    const value = new Date(`${date}T12:00:00Z`);
    value.setUTCDate(value.getUTCDate() + amount);
    return value.toISOString().slice(0, 10);
  }

  private async safeLog(action: string, details: Record<string, unknown>) {
    try {
      await this.logs.create(action, null, details);
    } catch (error) {
      console.error('Admin booking log failed:', error);
    }
  }
}
