import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { Repository } from 'typeorm';

import { GuestChangeTableDto } from './dto/guest-change-table.dto';
import { BookingHistory } from './entities/booking-history.entity';
import { BookingTableChangeRequest } from './entities/booking-table-change-request.entity';
import { Booking } from './entities/booking.entity';
import { GuestBookingsService } from './guest-bookings.service';

@Injectable()
export class GuestTableChangeRequestsService {
  constructor(
    @InjectRepository(Booking)
    private readonly bookings: Repository<Booking>,
    @InjectRepository(BookingHistory)
    private readonly histories: Repository<BookingHistory>,
    @InjectRepository(BookingTableChangeRequest)
    private readonly requests: Repository<BookingTableChangeRequest>,
    private readonly guestBookings: GuestBookingsService,
  ) {}

  async request(bookingId: string, token: string, dto: GuestChangeTableDto) {
    const requestedTableNumber = String(dto.tableNumber || '').trim() || null;

    const booking = await this.bookings
      .createQueryBuilder('booking')
      .addSelect('booking.guestAccessTokenHash')
      .leftJoinAndSelect('booking.table', 'table')
      .leftJoinAndSelect('table.zone', 'zone')
      .leftJoinAndSelect('booking.client', 'client')
      .where('booking.id = :bookingId', { bookingId })
      .getOne();

    if (!booking || booking.guestAccessTokenHash !== this.hashToken(token)) {
      throw new UnauthorizedException('Недійсний доступ до бронювання');
    }

    if (!['pending', 'approved'].includes(booking.status) || booking.checkedInAt) {
      throw new BadRequestException('Зміна столу для цієї броні вже недоступна');
    }

    let request = await this.requests.findOne({
      where: {
        booking: { id: booking.id },
        status: 'pending',
      } as any,
      relations: ['booking'],
    });

    if (request) {
      request.requestedTableNumber = requestedTableNumber;
      request.adminComment = null;
    } else {
      request = this.requests.create({
        booking,
        requestedTableNumber,
        selectedTable: null,
        status: 'pending',
        adminComment: null,
        resolvedAt: null,
      });
    }

    await this.requests.save(request);
    await this.histories.save(
      this.histories.create({
        booking,
        action: 'guest_requested_table_change',
        actorRole: 'guest',
        actorStaffId: null,
        actorName: null,
        previousData: {
          tableId: booking.table?.id || null,
          tableNumber: booking.table?.tableNumber || null,
        },
        newData: { requestedTableNumber },
        reason: requestedTableNumber
          ? `Гість просить інший стіл, бажано №${requestedTableNumber}`
          : 'Гість просить підібрати інший стіл',
        isManualMode: false,
      }),
    );

    return {
      message: 'Запит на зміну столу надіслано Адміністратору',
      booking: await this.guestBookings.get(bookingId, token),
    };
  }

  private hashToken(token: string) {
    const normalized = String(token || '').trim();
    if (!normalized || normalized.length > 256) {
      throw new UnauthorizedException('Недійсний доступ до бронювання');
    }
    return createHash('sha256').update(normalized).digest('hex');
  }
}
