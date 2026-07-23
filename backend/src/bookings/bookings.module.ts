import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Client } from '../clients/entities/client.entity';
import { LogsModule } from '../logs/logs.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { Restaurant } from '../restaurant/entities/restaurant.entity';
import { TableEntity } from '../tables/entities/table.entity';

import { AdminBookingsController } from './admin-bookings.controller';
import { AdminBookingsService } from './admin-bookings.service';
import { BookingCreationLockService } from './booking-creation-lock.service';
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
  controllers: [BookingsController, AdminBookingsController],
  providers: [
    BookingsService,
    GuestBookingsService,
    BookingExpirationService,
    AdminBookingsService,
    BookingCreationLockService,
  ],
  exports: [BookingsService, GuestBookingsService, AdminBookingsService],
})
export class BookingsModule {}
