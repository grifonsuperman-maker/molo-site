import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { BookingHistory } from '../bookings/entities/booking-history.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { Staff } from '../staff/entities/staff.entity';
import { TableOwnershipService } from '../tables/table-ownership.service';
import { TablesModule } from '../tables/tables.module';
import { createCoordinatedWaiterCallsService, RAW_WAITER_CALLS_SERVICE } from './coordinated-waiter-calls.provider';
import { WaiterCallRecord } from './entities/waiter-call.entity';
import { WaiterCallTelegramNotifierService } from './waiter-call-telegram-notifier.service';
import { WaiterCallsController } from './waiter-calls.controller';
import { WaiterCallsService } from './waiter-calls.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Booking, BookingHistory, WaiterCallRecord, Staff]),
    NotificationsModule,
    TablesModule,
  ],
  controllers: [WaiterCallsController],
  providers: [
    { provide: RAW_WAITER_CALLS_SERVICE, useClass: WaiterCallsService },
    {
      provide: WaiterCallsService,
      useFactory: createCoordinatedWaiterCallsService,
      inject: [RAW_WAITER_CALLS_SERVICE, DataSource, TableOwnershipService],
    },
    WaiterCallTelegramNotifierService,
  ],
  exports: [WaiterCallsService],
})
export class WaiterCallsModule {}
