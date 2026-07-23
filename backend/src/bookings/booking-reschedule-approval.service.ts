import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { TableEntity } from '../tables/entities/table.entity';
import { BookingRescheduleRequest } from './entities/booking-reschedule-request.entity';
import { Booking, BookingStatus } from './entities/booking.entity';

const ACTIVE_BOOKING_STATUSES: BookingStatus[] = ['pending', 'approved'];
const DEFAULT_DURATION_MINUTES = 120;
const CLEANUP_MINUTES = 15;

@Injectable()
export class BookingRescheduleApprovalService {
  constructor(private readonly dataSource: DataSource) {}

  async approve(requestId: string) {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const requestRepository = manager.getRepository(BookingRescheduleRequest);
        const preview = await requestRepository.findOne({
          where: { id: requestId },
          relations: ['booking', 'booking.table'],
        });

        if (!preview) throw new NotFoundException('Запит не знайдено');
        if (!preview.booking?.table?.id) {
          throw new BadRequestException('Для бронювання не призначено стіл');
        }

        let lockedTableId = preview.booking.table.id;
        let lockedDate = preview.requestedDate;
        await this.lockSlot(manager, lockedTableId, lockedDate);

        const bookingRepository = manager.getRepository(Booking);
        const lockedBooking = await bookingRepository.findOne({
          where: { id: preview.booking.id },
          lock: { mode: 'pessimistic_write' },
        });
        if (!lockedBooking) throw new NotFoundException('Бронювання не знайдено');

        const request = await requestRepository.findOne({
          where: { id: requestId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!request) throw new NotFoundException('Запит не знайдено');
        if (request.status !== 'pending') {
          throw new BadRequestException('Цей запит уже опрацьовано');
        }

        const booking = await bookingRepository.findOne({
          where: { id: lockedBooking.id },
          relations: ['table'],
        });
        if (!booking) throw new NotFoundException('Бронювання не знайдено');
        if (!booking.table?.id) {
          throw new BadRequestException('Для бронювання не призначено стіл');
        }
        if (!ACTIVE_BOOKING_STATUSES.includes(booking.status) || booking.checkedInAt) {
          throw new BadRequestException('Перенесення для цієї броні вже недоступне');
        }

        this.validateRequestedDate(request.requestedDate);
        const requestedTime = this.normalizeTime(request.requestedTime);

        if (
          booking.table.id !== lockedTableId ||
          request.requestedDate !== lockedDate
        ) {
          lockedTableId = booking.table.id;
          lockedDate = request.requestedDate;
          await this.lockSlot(manager, lockedTableId, lockedDate);
        }

        const tableRepository = manager.getRepository(TableEntity);
        const lockedTable = await tableRepository.findOne({
          where: { id: booking.table.id },
          lock: { mode: 'pessimistic_write' },
        });
        if (!lockedTable) throw new NotFoundException('Стіл не знайдено');

        const table = await tableRepository.findOne({
          where: { id: lockedTable.id },
          relations: ['zone'],
        });
        if (!table) throw new NotFoundException('Стіл не знайдено');
        this.assertTableAvailable(table);

        const durationMinutes = this.duration(booking);
        const requestedStart = this.timeToMinutes(requestedTime);
        const requestedAvailableFrom =
          requestedStart + durationMinutes + CLEANUP_MINUTES;

        const candidates = await bookingRepository
          .createQueryBuilder('candidate')
          .where('candidate.table_id = :tableId', { tableId: table.id })
          .andWhere('candidate.bookingDate = :bookingDate', {
            bookingDate: request.requestedDate,
          })
          .andWhere('candidate.status IN (:...statuses)', {
            statuses: ACTIVE_BOOKING_STATUSES,
          })
          .andWhere('candidate.id != :bookingId', { bookingId: booking.id })
          .orderBy('candidate.bookingTime', 'ASC')
          .getMany();

        const conflict = candidates.find((candidate) => {
          const existingStart = this.timeToMinutes(candidate.bookingTime);
          const existingAvailableFrom =
            existingStart + this.duration(candidate) + CLEANUP_MINUTES;
          return (
            requestedStart < existingAvailableFrom &&
            requestedAvailableFrom > existingStart
          );
        });

        if (conflict) {
          const conflictStart = this.timeLabel(conflict.bookingTime);
          const conflictEnd = this.timeLabel(
            this.timeFromMinutes(
              this.timeToMinutes(conflict.bookingTime) + this.duration(conflict),
            ),
          );
          throw new BadRequestException(
            `Стіл уже зайнятий ${conflictStart} — ${conflictEnd}. Оберіть інший час.`,
          );
        }

        booking.bookingDate = request.requestedDate;
        booking.bookingTime = requestedTime;
        await bookingRepository.save(booking);

        request.status = 'approved';
        request.resolvedAt = new Date();
        await requestRepository.save(request);

        return { message: 'Перенесення підтверджено' };
      });
    } catch (error: any) {
      if (error?.code === '23505') {
        throw new BadRequestException(
          'На цю дату вже є активне бронювання з цього пристрою або номера телефону',
        );
      }
      throw error;
    }
  }

  private async lockSlot(
    manager: EntityManager,
    tableId: string,
    bookingDate: string,
  ) {
    await manager.query(
      'SELECT pg_advisory_xact_lock(hashtext($1::text), hashtext($2::text))',
      [tableId, bookingDate],
    );
  }

  private validateRequestedDate(value: string) {
    const requestedDate = String(value || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) {
      throw new BadRequestException('Невірний формат дати перенесення');
    }
    if (requestedDate < this.kyivDate()) {
      throw new BadRequestException('Не можна перенести бронювання на минулу дату');
    }
  }

  private normalizeTime(value: string) {
    const time = String(value || '').trim();
    if (!/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(time)) {
      throw new BadRequestException('Невірний формат часу перенесення');
    }
    return `${time.slice(0, 5)}:00`;
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
      throw new BadRequestException('Невірний формат часу перенесення');
    }
    return hours * 60 + minutes;
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

  private assertTableAvailable(table: TableEntity) {
    if (!table.isVisible || table.status === 'closed') {
      throw new BadRequestException('Стіл зараз недоступний для бронювання');
    }
    if (table.zone?.isClosed || table.zone?.isVisible === false) {
      throw new BadRequestException('Ця зона зараз закрита для бронювання');
    }
  }

  private timeFromMinutes(totalMinutes: number) {
    const normalized = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
    const hours = Math.floor(normalized / 60);
    const minutes = normalized % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;
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
