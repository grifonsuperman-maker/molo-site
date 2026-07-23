import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Client } from '../clients/entities/client.entity';
import { LogsModule } from '../logs/logs.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { Restaurant } from '../restaurant/entities/restaurant.entity';
import { TableEntity } from '../tables/entities/table.entity';

import { BookingCalendarController } from './booking-calendar.controller';
import { BookingCalendarService } from './booking-calendar.service';
import { BookingExpirationService } from './booking-expiration.service';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { GuestBookingsService } from './guest-bookings.service';
import { BookingHistory } from './entities/booking-history.entity';
import { BookingRescheduleRequest } from './entities/booking-reschedule-request.entity';
import { Booking } from './entities/booking.entity';
import { GuestReview } from './entities/guest-review.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Booking,
      BookingHistory,
      BookingRescheduleRequest,
      GuestReview,
      Client,
      TableEntity,
      Restaurant,
    ]),
    LogsModule,
    NotificationsModule,
  ],
  controllers: [BookingsController, BookingCalendarController],
  providers: [
    BookingsService,
    GuestBookingsService,
    BookingExpirationService,
    BookingCalendarService,
  ],
  exports: [BookingsService, GuestBookingsService],
})
export class BookingsModule {}
