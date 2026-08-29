import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';

import type { AuthUser } from '../auth/types/auth-user.type';
import { LogsService } from '../logs/logs.service';
import { TelegramService } from '../notifications/telegram.service';
import { TableEntity } from '../tables/entities/table.entity';
import { Zone } from '../zones/entities/zone.entity';
import { CheckAvailabilityDto } from './dto/check-availability.dto';
import { CreateAvailabilityBlockDto } from './dto/create-availability-block.dto';
import { CreateBookingDto } from './dto/create-booking.dto';
import { TransferFutureBookingDto } from './dto/transfer-future-booking.dto';
import { AvailabilityBlock } from './entities/availability-block.entity';
import { Booking, BookingStatus } from './entities/booking.entity';
import { BookingHistory } from './entities/booking-history.entity';

const ACTIVE_BOOKING_STATUSES: BookingStatus[] = ['pending', 'approved'];
const DEFAULT_DURATION_MINUTES = 120;
const CLEANUP_MINUTES = 15;

type TableStatusPayload = {
  tableId: string;
  tableNumber: string;
  status: TableEntity['status'];
  reason: string | null;
  conflict: unknown;
  block?: AvailabilityBlock | null;
};

@Injectable()
export class AvailabilityBlocksService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(AvailabilityBlock)
    private readonly blocks: Repository<AvailabilityBlock>,
    @InjectRepository(Booking)
    private readonly bookings: Repository<Booking>,
    @InjectRepository(BookingHistory)
    private readonly histories: Repository<BookingHistory>,
    @InjectRepository(TableEntity)
    private readonly tables: Repository<TableEntity>,
    @InjectRepository(Zone)
    private readonly zones: Repository<Zone>,
    private readonly logs: LogsService,
    private readonly telegram: TelegramService,
  ) {}

  async list(blockDate: string) {
    const date = this.normalizeDate(blockDate);
    return this.blocks.find({
      where: { blockDate: date },
      relations: ['table', 'table.zone', 'zone'],
      order: { createdAt: 'DESC' },
    });
  }

  async create(dto: CreateAvailabilityBlockDto, actor?: AuthUser) {
    const target = this.normalizeTarget(dto.tableId, dto.zoneId);
    const blockDate = this.normalizeDate(dto.blockDate);
    const { startTime, endTime } = this.normalizeTimeRange(dto.startTime, dto.endTime);
    const reason = String(dto.reason || '').trim();
    if (!reason) throw new BadRequestException('Вкажіть причину недоступності');

    const table = target.tableId
      ? await this.tables.findOne({ where: { id: target.tableId }, relations: ['zone'] })
      : null;
    const zone = target.zoneId
      ? await this.zones.findOne({ where: { id: target.zoneId } })
      : null;
    if (target.tableId && !table) throw new NotFoundException('Стіл не знайдено');
    if (target.zoneId && !zone) throw new NotFoundException('Локацію не знайдено');

    const existingBlocks = await this.blocks.find({
      where: { blockDate },
      relations: ['table', 'zone'],
    });
    const duplicate = existingBlocks.find((block) =>
      this.sameTarget(block, target.tableId, target.zoneId) &&
      this.rangesOverlap(block.startTime, block.endTime, startTime, endTime),
    );
    if (duplicate) {
      throw new BadRequestException('На цей час уже запланована недоступність');
    }

    const conflicts = await this.findBookingConflicts(
      this.bookings.manager,
      blockDate,
      target.tableId,
      target.zoneId,
      startTime,
      endTime,
    );
    if (conflicts.length) {
      const shortList = conflicts
        .slice(0, 4)
        .map((booking) => `${this.timeLabel(booking.bookingTime)} · стіл №${booking.table?.tableNumber || '-'}`)
        .join(', ');
      throw new BadRequestException(
        `Є активні бронювання: ${shortList}${conflicts.length > 4 ? ` та ще ${conflicts.length - 4}` : ''}. Спочатку перенесіть або скасуйте їх.`,
      );
    }

    const saved = await this.blocks.save(
      this.blocks.create({
        table,
        zone,
        blockDate,
        startTime,
        endTime,
        reason,
      }),
    );

    await this.logs.create('Заплановано недоступність', null, {
      availabilityBlockId: saved.id,
      tableId: table?.id || null,
      tableNumber: table?.tableNumber || null,
      zoneId: zone?.id || null,
      zoneName: zone?.name || null,
      blockDate,
      startTime,
      endTime,
      reason,
      actorRole: actor?.role || null,
      actorStaffId: actor?.staffId || null,
      actorName: actor?.name || null,
    });

    return this.blocks.findOne({
      where: { id: saved.id },
      relations: ['table', 'table.zone', 'zone'],
    });
  }

  async remove(id: string, actor?: AuthUser) {
    const block = await this.blocks.findOne({
      where: { id },
      relations: ['table', 'zone'],
    });
    if (!block) throw new NotFoundException('Заплановану недоступність не знайдено');

    await this.blocks.remove(block);
    await this.logs.create('Скасовано заплановану недоступність', null, {
      availabilityBlockId: id,
      tableId: block.table?.id || null,
      tableNumber: block.table?.tableNumber || null,
      zoneId: block.zone?.id || null,
      zoneName: block.zone?.name || null,
      blockDate: block.blockDate,
      startTime: block.startTime,
      endTime: block.endTime,
      reason: block.reason,
      actorRole: actor?.role || null,
      actorStaffId: actor?.staffId || null,
      actorName: actor?.name || null,
    });

    return { message: 'Заплановану недоступність скасовано' };
  }

  async assertBookable(
    dto: Pick<
      CreateBookingDto,
      'tableId' | 'tableNumber' | 'bookingDate' | 'bookingTime' | 'durationMinutes'
    >,
  ) {
    const table = await this.resolveTable(dto.tableId, dto.tableNumber);
    if (!table) return;
    const start = this.parseTime(dto.bookingTime);
    const end = start + this.normalizeDuration(dto.durationMinutes) + CLEANUP_MINUTES;
    const block = await this.findBlockConflict(
      dto.bookingDate,
      table.id,
      table.zone?.id || null,
      start,
      end,
    );
    if (block) {
      throw new BadRequestException(
        block.zone
          ? `Локація «${block.zone.name}» недоступна у цей час. Причина: ${block.reason}`
          : `Стіл №${table.tableNumber} недоступний у цей час. Причина: ${block.reason}`,
      );
    }
  }

  async applyAvailability(dto: CheckAvailabilityDto, payload: Record<string, any>) {
    if (!payload?.isAvailable) return payload;
    const table = await this.tables.findOne({ where: { id: dto.tableId }, relations: ['zone'] });
    if (!table) return payload;
    const start = this.parseTime(dto.bookingTime);
    const end = start + this.normalizeDuration(dto.durationMinutes) + CLEANUP_MINUTES;
    const block = await this.findBlockConflict(
      dto.bookingDate,
      table.id,
      table.zone?.id || null,
      start,
      end,
    );
    if (!block) return payload;

    return {
      ...payload,
      isAvailable: false,
      reason: 'availability_block',
      conflict: null,
      availabilityBlock: this.serializeBlock(block),
    };
  }

  async applyTableStatuses(dto: Partial<CheckAvailabilityDto>, payload: Record<string, any>) {
    const bookingDate = this.normalizeDate(String(dto.bookingDate || ''));
    const bookingTime = String(dto.bookingTime || '19:00');
    const start = this.parseTime(bookingTime);
    const end = start + this.normalizeDuration(dto.durationMinutes) + CLEANUP_MINUTES;
    const [blocks, tables] = await Promise.all([
      this.blocks.find({
        where: { blockDate: bookingDate },
        relations: ['table', 'zone'],
      }),
      this.tables.find({ relations: ['zone'] }),
    ]);
    if (!blocks.length || !payload?.statuses) return payload;

    const tableById = new Map(tables.map((table) => [table.id, table]));
    const statuses = { ...payload.statuses } as Record<string, TableStatusPayload>;

    Object.entries(statuses).forEach(([tableNumber, status]) => {
      const table = tableById.get(status.tableId);
      if (!table) return;
      const block = blocks.find((candidate) =>
        (candidate.table?.id === table.id || candidate.zone?.id === table.zone?.id) &&
        this.blockOverlapsMinutes(candidate, start, end),
      );
      if (!block) return;
      statuses[tableNumber] = {
        ...status,
        status: 'closed',
        reason: 'availability_block',
        conflict: null,
        block: this.serializeBlock(block) as any,
      };
    });

    return { ...payload, statuses };
  }

  async transferBooking(
    bookingId: string,
    dto: TransferFutureBookingDto,
    actor?: AuthUser,
  ) {
    const result = await this.dataSource.transaction(async (manager) => {
      const booking = await manager.getRepository(Booking).findOne({
        where: { id: bookingId },
        relations: ['table', 'table.zone', 'client'],
        lock: { mode: 'pessimistic_write' },
      });
      if (!booking || !ACTIVE_BOOKING_STATUSES.includes(booking.status)) {
        throw new BadRequestException('Перенесення доступне лише для активного бронювання');
      }
      if (!booking.table) throw new BadRequestException('У бронювання немає поточного столу');
      if (booking.bookingDate < this.today()) {
        throw new BadRequestException('Минуле бронювання змінити неможливо');
      }

      const nextTable = await manager.getRepository(TableEntity).findOne({
        where: { id: dto.tableId },
        relations: ['zone'],
        lock: { mode: 'pessimistic_write' },
      });
      if (!nextTable || !nextTable.isVisible || nextTable.status === 'closed') {
        throw new BadRequestException('Новий стіл закритий або недоступний');
      }
      if (nextTable.zone?.isClosed || nextTable.zone?.isVisible === false) {
        throw new BadRequestException('Локація нового столу недоступна');
      }
      if (nextTable.id === booking.table.id) {
        throw new BadRequestException('Оберіть інший стіл');
      }
      if (Number(nextTable.seats) < Number(booking.guestsCount)) {
        throw new BadRequestException('Новий стіл не вміщує всіх гостей');
      }

      const start = this.parseTime(booking.bookingTime);
      const end = start + this.bookingDuration(booking) + CLEANUP_MINUTES;
      const destinationBookings = await manager
        .getRepository(Booking)
        .createQueryBuilder('booking')
        .leftJoinAndSelect('booking.table', 'table')
        .where('table.id = :tableId', { tableId: nextTable.id })
        .andWhere('booking.bookingDate = :bookingDate', { bookingDate: booking.bookingDate })
        .andWhere('booking.status IN (:...statuses)', { statuses: ACTIVE_BOOKING_STATUSES })
        .andWhere('booking.id != :bookingId', { bookingId: booking.id })
        .getMany();
      const bookingConflict = destinationBookings.find((candidate) => {
        const candidateStart = this.parseTime(candidate.bookingTime);
        const candidateEnd = candidateStart + this.bookingDuration(candidate) + CLEANUP_MINUTES;
        return start < candidateEnd && end > candidateStart;
      });
      if (bookingConflict) {
        throw new BadRequestException('На новому столі вже є бронювання у цей час');
      }

      const blockConflict = await this.findBlockConflictWithManager(
        manager,
        booking.bookingDate,
        nextTable.id,
        nextTable.zone?.id || null,
        start,
        end,
      );
      if (blockConflict) {
        throw new BadRequestException('Новий стіл заплановано недоступним у цей час');
      }

      const previousTable = booking.table;
      const previousData = {
        tableId: previousTable.id,
        tableNumber: previousTable.tableNumber,
        bookingDate: booking.bookingDate,
        bookingTime: booking.bookingTime,
      };
      const reason = String(dto.reason || 'Перенесення через планову недоступність').trim();
      booking.table = nextTable;
      booking.manualChangeReason = reason;
      booking.manuallyChangedAt = new Date();
      booking.guestNotification = {
        type: 'manual_change',
        title: `Ваш стіл змінено на №${nextTable.tableNumber}`,
        message: reason,
        reason,
        previousTableNumber: previousTable.tableNumber,
        newTableNumber: nextTable.tableNumber,
        createdAt: new Date().toISOString(),
      };
      await manager.getRepository(Booking).save(booking);
      await manager.getRepository(BookingHistory).save(
        manager.getRepository(BookingHistory).create({
          booking,
          action: 'admin_future_table_transfer',
          actorRole: actor?.role || 'admin',
          actorStaffId: actor?.staffId || null,
          actorName: actor?.name || null,
          previousData,
          newData: {
            tableId: nextTable.id,
            tableNumber: nextTable.tableNumber,
            bookingDate: booking.bookingDate,
            bookingTime: booking.bookingTime,
          },
          reason,
          isManualMode: true,
        }),
      );

      return {
        booking,
        previousTableNumber: previousTable.tableNumber,
        newTableNumber: nextTable.tableNumber,
        clientTelegramId: booking.client?.telegramId || null,
      };
    });

    await this.logs.create('Перенесено майбутнє бронювання на інший стіл', null, {
      bookingId,
      previousTableNumber: result.previousTableNumber,
      newTableNumber: result.newTableNumber,
      actorRole: actor?.role || null,
      actorStaffId: actor?.staffId || null,
      actorName: actor?.name || null,
    });

    if (result.clientTelegramId) {
      const text = [
        '🪑 <b>Ваш стіл змінено</b>',
        '',
        `Новий стіл: <b>№${result.newTableNumber}</b>`,
        `Дата: <b>${result.booking.bookingDate}</b>`,
        `Час: <b>${this.timeLabel(result.booking.bookingTime)}</b>`,
      ].join('\n');
      try {
        await this.telegram.sendMessage(result.clientTelegramId, text);
      } catch (error) {
        console.error('Guest table-change notification failed:', error);
      }
    }

    return {
      message: `Бронювання перенесено на стіл №${result.newTableNumber}`,
      booking: result.booking,
    };
  }

  private async resolveTable(tableId?: string, tableNumber?: string) {
    const id = String(tableId || '').trim();
    const number = String(tableNumber || '').trim();
    if (id && !id.startsWith('visual-')) {
      const table = await this.tables.findOne({ where: { id }, relations: ['zone'] });
      if (table) return table;
    }
    if (number) {
      return this.tables.findOne({ where: { tableNumber: number }, relations: ['zone'] });
    }
    return null;
  }

  private async findBlockConflict(
    blockDate: string,
    tableId: string,
    zoneId: string | null,
    start: number,
    end: number,
  ) {
    return this.findBlockConflictWithManager(
      this.blocks.manager,
      this.normalizeDate(blockDate),
      tableId,
      zoneId,
      start,
      end,
    );
  }

  private async findBlockConflictWithManager(
    manager: EntityManager,
    blockDate: string,
    tableId: string,
    zoneId: string | null,
    start: number,
    end: number,
  ) {
    const blocks = await manager.getRepository(AvailabilityBlock).find({
      where: { blockDate },
      relations: ['table', 'zone'],
    });
    return blocks.find((block) =>
      (block.table?.id === tableId || Boolean(zoneId && block.zone?.id === zoneId)) &&
      this.blockOverlapsMinutes(block, start, end),
    ) || null;
  }

  private async findBookingConflicts(
    manager: EntityManager,
    blockDate: string,
    tableId: string | null,
    zoneId: string | null,
    startTime: string | null,
    endTime: string | null,
  ) {
    const query = manager
      .getRepository(Booking)
      .createQueryBuilder('booking')
      .leftJoinAndSelect('booking.table', 'table')
      .leftJoinAndSelect('table.zone', 'zone')
      .leftJoinAndSelect('booking.client', 'client')
      .where('booking.bookingDate = :blockDate', { blockDate })
      .andWhere('booking.status IN (:...statuses)', { statuses: ACTIVE_BOOKING_STATUSES });
    if (tableId) query.andWhere('table.id = :tableId', { tableId });
    if (zoneId) query.andWhere('zone.id = :zoneId', { zoneId });
    const bookings = await query.orderBy('booking.bookingTime', 'ASC').getMany();
    if (!startTime || !endTime) return bookings;
    const start = this.parseTime(startTime);
    const end = this.parseTime(endTime);
    return bookings.filter((booking) => {
      const bookingStart = this.parseTime(booking.bookingTime);
      const bookingEnd = bookingStart + this.bookingDuration(booking) + CLEANUP_MINUTES;
      return start < bookingEnd && end > bookingStart;
    });
  }

  private normalizeTarget(tableId?: string, zoneId?: string) {
    const table = String(tableId || '').trim() || null;
    const zone = String(zoneId || '').trim() || null;
    if ((table && zone) || (!table && !zone)) {
      throw new BadRequestException('Оберіть один стіл або одну локацію');
    }
    return { tableId: table, zoneId: zone };
  }

  private normalizeDate(value: string) {
    const date = String(value || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BadRequestException('Оберіть коректну дату');
    }
    if (date < this.today()) {
      throw new BadRequestException('Не можна планувати недоступність у минулому');
    }
    return date;
  }

  private normalizeTimeRange(start?: string, end?: string) {
    const startTime = String(start || '').trim() || null;
    const endTime = String(end || '').trim() || null;
    if (Boolean(startTime) !== Boolean(endTime)) {
      throw new BadRequestException('Вкажіть і початок, і завершення періоду');
    }
    if (startTime && endTime && this.parseTime(startTime) >= this.parseTime(endTime)) {
      throw new BadRequestException('Час завершення має бути пізніше часу початку');
    }
    return {
      startTime: startTime ? `${startTime}:00` : null,
      endTime: endTime ? `${endTime}:00` : null,
    };
  }

  private sameTarget(block: AvailabilityBlock, tableId: string | null, zoneId: string | null) {
    return block.table?.id === tableId && block.zone?.id === zoneId;
  }

  private rangesOverlap(
    leftStart: string | null,
    leftEnd: string | null,
    rightStart: string | null,
    rightEnd: string | null,
  ) {
    if (!leftStart || !leftEnd || !rightStart || !rightEnd) return true;
    return this.parseTime(leftStart) < this.parseTime(rightEnd) &&
      this.parseTime(leftEnd) > this.parseTime(rightStart);
  }

  private blockOverlapsMinutes(block: AvailabilityBlock, start: number, end: number) {
    if (!block.startTime || !block.endTime) return true;
    return this.parseTime(block.startTime) < end && this.parseTime(block.endTime) > start;
  }

  private parseTime(value: string) {
    const [hoursRaw, minutesRaw] = String(value || '').split(':');
    const hours = Number(hoursRaw);
    const minutes = Number(minutesRaw);
    if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
      throw new BadRequestException('Невірний формат часу');
    }
    return hours * 60 + minutes;
  }

  private normalizeDuration(value?: number | null) {
    const duration = Number(value || DEFAULT_DURATION_MINUTES);
    if (!Number.isFinite(duration)) return DEFAULT_DURATION_MINUTES;
    return Math.min(720, Math.max(30, Math.round(duration)));
  }

  private bookingDuration(booking: Booking) {
    const stored = Number(booking.durationMinutes);
    if (Number.isFinite(stored) && stored >= 30) return this.normalizeDuration(stored);
    const match = String(booking.wishes || '').match(/Час відпочинку:\s*(\d+)\s*хв/i);
    return match ? this.normalizeDuration(Number(match[1])) : DEFAULT_DURATION_MINUTES;
  }

  private timeLabel(value: string | null | undefined) {
    const [hours = '00', minutes = '00'] = String(value || '').split(':');
    return `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}`;
  }

  private serializeBlock(block: AvailabilityBlock) {
    return {
      id: block.id,
      blockDate: block.blockDate,
      startTime: block.startTime,
      endTime: block.endTime,
      reason: block.reason,
      table: block.table
        ? { id: block.table.id, tableNumber: block.table.tableNumber }
        : null,
      zone: block.zone
        ? { id: block.zone.id, name: block.zone.name }
        : null,
    };
  }

  private today() {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Kyiv',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    const value = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((part) => part.type === type)?.value || '';
    return `${value('year')}-${value('month')}-${value('day')}`;
  }
}
