import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Booking } from '../bookings/entities/booking.entity';
import { Staff } from '../staff/entities/staff.entity';
import { HookahCall } from './entities/hookah-call.entity';
import { HookahCallsController } from './hookah-calls.controller';
import { HookahCallsService } from './hookah-calls.service';

@Module({ imports: [ TypeOrmModule.forFeature([ HookahCall, Booking, Staff, ]), ], controllers: [HookahCallsController], providers: [HookahCallsService], exports: [HookahCallsService], })
export class HookahCallsModule {}
