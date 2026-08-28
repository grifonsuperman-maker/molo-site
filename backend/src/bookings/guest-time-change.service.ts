import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';

import { RequestRescheduleDto } from './dto/request-reschedule.dto';
import { BookingRescheduleRequest } from './entities/booking-reschedule-request.entity';
import { Booking } from './entities/booking.entity';
import { GuestBookingsService } from './guest-bookings.service';

@Injectable()
export class GuestTimeChangeService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly guestBookings: GuestBookingsService,
  ) {}

  async request(id: string, token: string, dto: RequestRescheduleDto) {
    // Перевіряємо per-booking token до будь-якої роботи з бронюванням.
    await this.guestBookings.get(id, token);

    const rescheduleRequest = await this.dataSource.transaction(async (manager) => {
      const bookingRepository = manager.getRepository(Booking);
      const booking = await bookingRepository.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });

      if (!booking) throw new NotFoundException('Бронювання не знайдено');
      if (booking.status !== 'approved' || booking.checkedInAt) {
        throw new BadRequestException('Зміна часу для цієї броні вже недоступна');
      }
      if (booking.bookingDate < this.kyivDate()) {
        throw new BadRequestException('Не можна змінити час для минулої броні');
      }

      const requestedDate = String(dto.requestedDate || '').slice(0, 10);
      if (requestedDate !== booking.bookingDate) {
        throw new BadRequestException('Можна змінити лише час прибуття, а не дату бронювання');
      }

      const requestedTime = this.normalizeTime(dto.requestedTime);
      if (requestedTime === this.normalizeTime(booking.bookingTime)) {
        throw new BadRequestException('Оберіть інший час прибуття');
      }

      const rescheduleRepository = manager.getRepository(BookingRescheduleRequest);
      const existingPendingRequest = await rescheduleRepository.findOne({
        where: { booking: { id: booking.id }, status: 'pending' } as any,
      });
      if (existingPendingRequest) {
        throw new ConflictException(
          'Для цієї броні вже очікує підтвердження запит на перенесення',
        );
      }

      // Lock уже утримується на базовому рядку booking. Відношення дочитуємо
      // окремо, щоб Telegram-сповіщення отримало стіл та дані гостя без JOIN-lock.
      const bookingWithRelations = await bookingRepository.findOne({
        where: { id: booking.id },
        relations: ['table', 'client'],
      });
      if (!bookingWithRelations) throw new NotFoundException('Бронювання не знайдено');

      return rescheduleRepository.save(
        rescheduleRepository.create({
          booking: bookingWithRelations,
          requestedDate: booking.bookingDate,
          requestedTime,
          status: 'pending',
          adminComment: null,
          resolvedAt: null,
        }),
      );
    });

    return {
      booking: await this.guestBookings.get(id, token),
      rescheduleRequest,
    };
  }

  private normalizeTime(value: string) {
    const time = String(value || '').trim();
    if (!/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(time)) {
      throw new BadRequestException('Вкажіть час прибуття у форматі ГГ:ХХ');
    }
    return `${time.slice(0, 5)}:00`;
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
