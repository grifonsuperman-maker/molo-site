import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Client } from '../clients/entities/client.entity';
import { LogsModule } from '../logs/logs.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { Restaurant } from '../restaurant/entities/restaurant.entity';
import { RestaurantModule } from '../restaurant/restaurant.module';
import { TableEntity } from '../tables/entities/table.entity';
import { WaiterCallsModule } from '../waiter-calls/waiter-calls.module';
import { Zone } from '../zones/entities/zone.entity';
import { AdminBookingEventsController } from './admin-booking-events.controller';
import { AdminBookingEventsService } from './admin-booking-events.service';
import { AvailabilityBlocksController } from './availability-blocks.controller';
import { AvailabilityBlocksService } from './availability-blocks.service';
import { BookingExpirationService } from './booking-expiration.service';
import { BookingTableLockService } from './booking-table-lock.service';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { AvailabilityBlock } from './entities/availability-block.entity';
import { BookingHistory } from './entities/booking-history.entity';
import { BookingRescheduleRequest } from './entities/booking-reschedule-request.entity';
import { Booking } from './entities/booking.entity';
import { GuestReview } from './entities/guest-review.entity';
import { GuestBookingsService } from './guest-bookings.service';
import { GuestReviewsController } from './guest-reviews.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Booking,
      BookingHistory,
      BookingRescheduleRequest,
      GuestReview,
      AvailabilityBlock,
      Client,
      TableEntity,
      Zone,
      Restaurant,
    ]),
    LogsModule,
    NotificationsModule,
    WaiterCallsModule,
    RestaurantModule,
  ],
  controllers: [
    BookingsController,
    AdminBookingEventsController,
    AvailabilityBlocksController,
    GuestReviewsController,
  ],
  providers: [
    BookingsService,
    GuestBookingsService,
    BookingExpirationService,
    BookingTableLockService,
    AdminBookingEventsService,
    AvailabilityBlocksService,
  ],
  exports: [BookingsService, GuestBookingsService, AvailabilityBlocksService],
})
export class BookingsModule {}
