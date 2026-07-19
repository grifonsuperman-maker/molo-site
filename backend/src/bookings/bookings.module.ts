import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Client } from '../clients/entities/client.entity';
import { LogsModule } from '../logs/logs.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { Restaurant } from '../restaurant/entities/restaurant.entity';
import { TableEntity } from '../tables/entities/table.entity';

import { BookingExpirationService } from './booking-expiration.service';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { BookingRescheduleRequest } from './entities/booking-reschedule-request.entity';
import { Booking } from './entities/booking.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Booking,
      BookingRescheduleRequest,
      Client,
      TableEntity,
      Restaurant,
    ]),
    LogsModule,
    NotificationsModule,
  ],
  controllers: [BookingsController],
  providers: [BookingsService, BookingExpirationService],
  exports: [BookingsService],
})
export class BookingsModule {}
