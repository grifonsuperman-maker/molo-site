import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Client } from '../clients/entities/client.entity';
import { LogsModule } from '../logs/logs.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { Restaurant } from '../restaurant/entities/restaurant.entity';
import { TableEntity } from '../tables/entities/table.entity';
import { WaiterCallsModule } from '../waiter-calls/waiter-calls.module';
import { Zone } from '../zones/entities/zone.entity';
import { AdminAttentionController } from './admin-attention.controller';
import { AdminAttentionService } from './admin-attention.service';
import { AdminBookingEventsController } from './admin-booking-events.controller';
import { AdminBookingEventsService } from './admin-booking-events.service';
import { AdminReviewsController } from './admin-reviews.controller';
import { AvailabilityBlocksController } from './availability-blocks.controller';
import { AvailabilityBlocksService } from './availability-blocks.service';
import { AvailabilityPermissionsService } from './availability-permissions.service';
import { BookingExpirationService } from './booking-expiration.service';
import { BookingRescheduleApprovalService } from './booking-reschedule-approval.service';
import { BookingTableLockService } from './booking-table-lock.service';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { AvailabilityBlock } from './entities/availability-block.entity';
import { BookingHistory } from './entities/booking-history.entity';
import { BookingRescheduleRequest } from './entities/booking-reschedule-request.entity';
import { Booking } from './entities/booking.entity';
import { GuestReview } from './entities/guest-review.entity';
import { GuestBookingsService } from './guest-bookings.service';
import { GuestRequestsController } from './guest-requests.controller';
import { GuestRequestsService } from './guest-requests.service';

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
  ],
  controllers: [
    BookingsController,
    AdminBookingEventsController,
    AdminAttentionController,
    AdminReviewsController,
    GuestRequestsController,
    AvailabilityBlocksController,
  ],
  providers: [
    BookingsService,
    GuestBookingsService,
    GuestRequestsService,
    BookingExpirationService,
    BookingRescheduleApprovalService,
    BookingTableLockService,
    AdminBookingEventsService,
    AdminAttentionService,
    AvailabilityBlocksService,
    AvailabilityPermissionsService,
  ],
  exports: [
    BookingsService,
    GuestBookingsService,
    GuestRequestsService,
    BookingRescheduleApprovalService,
    AvailabilityBlocksService,
  ],
})
export class BookingsModule {}
