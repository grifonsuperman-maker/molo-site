import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Booking } from '../bookings/entities/booking.entity';
import { BookingsModule } from '../bookings/bookings.module';
import { Staff } from '../staff/entities/staff.entity';
import { HookahCall } from './entities/hookah-call.entity';
import { HookahCallsController } from './hookah-calls.controller';
import { HookahCallsService } from './hookah-calls.service';

@Module({ imports: [ TypeOrmModule.forFeature([ HookahCall, Booking, Staff, ]), BookingsModule, ], controllers: [HookahCallsController], providers: [HookahCallsService], exports: [HookahCallsService], })
export class HookahCallsModule {}
