import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SchedulesService } from './schedules.service';
import { AutomaticNoShowService } from './automatic-no-show.service';
import { BookingsModule } from '../bookings/bookings.module';
import { Booking } from '../bookings/entities/booking.entity';
import { Restaurant } from '../restaurant/entities/restaurant.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { LogsModule } from '../logs/logs.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Booking, Restaurant]),
    BookingsModule,
    NotificationsModule,
    LogsModule,
  ],
  providers: [SchedulesService, AutomaticNoShowService],
})
export class SchedulesModule {}
