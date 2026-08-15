import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { BookingHistory } from '../bookings/entities/booking-history.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { WaiterCallRecord } from './entities/waiter-call.entity';
import { WaiterCallsController } from './waiter-calls.controller';
import { WaiterCallsService } from './waiter-calls.service';

@Module({
  imports: [TypeOrmModule.forFeature([Booking, BookingHistory, WaiterCallRecord])],
  controllers: [WaiterCallsController],
  providers: [WaiterCallsService],
  exports: [WaiterCallsService],
})
export class WaiterCallsModule {}
