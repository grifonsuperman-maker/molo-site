import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Booking } from '../bookings/entities/booking.entity';
import { Staff } from '../staff/entities/staff.entity';
import { NotificationsService } from './notifications.service';
import { TelegramService } from './telegram.service';

@Module({
  imports: [TypeOrmModule.forFeature([Staff, Booking])],
  providers: [TelegramService, NotificationsService],
  exports: [TelegramService, NotificationsService],
})
export class NotificationsModule {}
