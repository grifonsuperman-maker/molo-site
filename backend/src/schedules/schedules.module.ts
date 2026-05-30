import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SchedulesService } from './schedules.service';
import { Booking } from '../bookings/entities/booking.entity';
import { Restaurant } from '../restaurant/entities/restaurant.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { LogsModule } from '../logs/logs.module';

@Module({
  imports: [TypeOrmModule.forFeature([Booking, Restaurant]), NotificationsModule, LogsModule],
  providers: [SchedulesService],
})
export class SchedulesModule {}
