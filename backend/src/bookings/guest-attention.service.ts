import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { DataSource, EntityManager, In, Repository } from 'typeorm';

import { AdminCall } from './entities/admin-call.entity';
import { BookingHistory } from './entities/booking-history.entity';
import { BookingTableChangeRequest } from './entities/booking-table-change-request.entity';
import { Booking, BookingStatus } from './entities/booking.entity';

const ACTIVE_BOOKING_STATUSES: BookingStatus[] = ['pending', 'approved'];

@Injectable()
export class GuestAttentionService {
  constructor(
    @InjectRepository(Booking)
    private readonly bookings: Repository<Booking>,
    @InjectRepository(AdminCall)
    private readonly adminCalls: Repository<AdminCall>,
    private readonly dataSource: DataSource,
  ) {}

  async requestTableChange(
    bookingId: string,
    token: string,
    payload: { tableNumber?: string | null },
  ) {
    const requestedTableNumber = String(payload?.tableNumber || '').trim() || null;

    await this.dataSource.transaction(async (manager) => {
      const booking = await this.findOwnedBooking(bookingId, token, manager, true);
      if (!ACTIVE_BOOKING_STATUSES.includes(booking.status) || booking.checkedInAt) {
        throw new BadRequestException('Запит на зміну столу для цієї броні вже недоступний');
      }

      const repository = manager.getRepository(BookingTableChangeRequest);
      let request = await repository.findOne({
        where: {
          booking: { id: booking.id },
          status: 'pending',
        } as any,
        relations: ['booking'],
        lock: { mode: 'pessimistic_write' },
      });

      if (request) {
        request.requestedTableNumber = requestedTableNumber;
        request.adminComment = null;
      } else {
        request = repository.create({
          booking,
          requestedTableNumber,
          status: 'pending',
          adminComment: null,
          resolvedAt: null,
        });
      }
      await repository.save(request);

      await this.saveHistory(manager, booking, 'guest_requested_table_change', {
        newData: { requestedTableNumber },
        reason: requestedTableNumber
          ? `Бажаний стіл №${requestedTableNumber}`
          : 'Гість просить підібрати інший стіл',
      });
    });

    return {
      message: 'Запит на зміну столу надіслано Адміністратору',
    };
  }

  async getAdminCallStatus(bookingId: string) {
    const booking = await this.bookings.findOne({
      where: { id: bookingId },
      relations: ['table'],
    });
    if (!booking) throw new BadRequestException('Бронювання не знайдено');

    const activeCall = await this.adminCalls.findOne({
      where: {
        booking: { id: booking.id },
        status: In(['new', 'accepted']),
      } as any,
      relations: ['booking'],
      order: { createdAt: 'DESC' },
    });

    return {
      bookingId: booking.id,
      tableNumber: booking.table?.tableNumber || null,
      canCall: Boolean(booking.status === 'approved' && booking.checkedInAt),
      activeCall,
    };
  }

  async createAdminCall(bookingId: string) {
    return this.dataSource.transaction(async (manager) => {
      const booking = await manager.getRepository(Booking).findOne({
        where: { id: bookingId },
        relations: ['table', 'client'],
        lock: { mode: 'pessimistic_write' },
      });
      if (!booking) throw new BadRequestException('Бронювання не знайдено');
      if (booking.status !== 'approved' || !booking.checkedInAt) {
        throw new BadRequestException('Виклик Адміністратора доступний після позначки «Гість прийшов»');
      }

      const repository = manager.getRepository(AdminCall);
      const existing = await repository.findOne({
        where: {
          booking: { id: booking.id },
          status: In(['new', 'accepted']),
        } as any,
        relations: ['booking'],
        lock: { mode: 'pessimistic_write' },
      });
      if (existing) {
        return { message: 'Виклик Адміністратора вже активний', call: existing };
      }

      try {
        const call = await repository.save(
          repository.create({
            booking,
            status: 'new',
            acceptedAt: null,
            completedAt: null,
          }),
        );
        await this.saveHistory(manager, booking, 'guest_called_admin', {
          newData: { adminCallId: call.id },
          reason: 'Гість викликав Адміністратора',
        });
        return { message: 'Адміністратора викликано', call };
      } catch (error: any) {
        if ((error?.code || error?.driverError?.code) === '23505') {
          throw new ConflictException('Виклик Адміністратора вже активний');
        }
        throw error;
      }
    });
  }

  private async findOwnedBooking(
    bookingId: string,
    token: string,
    manager?: EntityManager,
    lock = false,
  ) {
    const normalized = String(token || '').trim();
    if (!normalized || normalized.length > 256) {
      throw new UnauthorizedException('Недійсний доступ до бронювання');
    }

    const repository = manager ? manager.getRepository(Booking) : this.bookings;
    let query = repository
      .createQueryBuilder('booking')
      .addSelect('booking.guestAccessTokenHash')
      .leftJoinAndSelect('booking.table', 'table')
      .leftJoinAndSelect('table.zone', 'zone')
      .leftJoinAndSelect('booking.client', 'client')
      .where('booking.id = :bookingId', { bookingId })
      .andWhere('booking.guestAccessTokenHash = :tokenHash', {
        tokenHash: createHash('sha256').update(normalized).digest('hex'),
      });

    if (lock) query = query.setLock('pessimistic_write', undefined, ['booking']);
    const booking = await query.getOne();
    if (!booking) throw new UnauthorizedException('Недійсний доступ до бронювання');
    return booking;
  }

  private async saveHistory(
    manager: EntityManager,
    booking: Booking,
    action: string,
    payload: {
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
        previousData: payload.previousData || null,
        newData: payload.newData || null,
        reason: payload.reason || null,
        isManualMode: false,
      }),
    );
  }
}
