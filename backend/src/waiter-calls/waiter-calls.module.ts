import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { BookingHistory } from '../bookings/entities/booking-history.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { Staff } from '../staff/entities/staff.entity';
import { WaiterCallRecord } from './entities/waiter-call.entity';
import { WaiterCallTelegramNotifierService } from './waiter-call-telegram-notifier.service';
import { WaiterCallsController } from './waiter-calls.controller';
import { WaiterCallsService } from './waiter-calls.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Booking, BookingHistory, WaiterCallRecord, Staff]),
    NotificationsModule,
  ],
  controllers: [WaiterCallsController],
  providers: [WaiterCallsService, WaiterCallTelegramNotifierService],
  exports: [WaiterCallsService],
})
export class WaiterCallsModule {}
