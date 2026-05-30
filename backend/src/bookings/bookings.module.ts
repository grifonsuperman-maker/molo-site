import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Booking } from './entities/booking.entity';
import { BookingRescheduleRequest } from './entities/booking-reschedule-request.entity';
import { Client } from '../clients/entities/client.entity';
import { TableEntity } from '../tables/entities/table.entity';
import { Restaurant } from '../restaurant/entities/restaurant.entity';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { LogsModule } from '../logs/logs.module';
import { NotificationsModule } from '../notifications/notifications.module';
@Module({ imports:[TypeOrmModule.forFeature([Booking,BookingRescheduleRequest,Client,TableEntity,Restaurant]), LogsModule, NotificationsModule], controllers:[BookingsController], providers:[BookingsService], exports:[BookingsService] })
export class BookingsModule {}
