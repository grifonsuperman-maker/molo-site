import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Booking } from "../bookings/entities/booking.entity";
import { NotificationsModule } from "../notifications/notifications.module";
import { Staff } from "../staff/entities/staff.entity";
import { Restaurant } from "../restaurant/entities/restaurant.entity";
import { WaiterCallsModule } from "../waiter-calls/waiter-calls.module";
import { HookahCall } from "./entities/hookah-call.entity";
import { HookahCallTelegramNotifierService } from "./hookah-call-telegram-notifier.service";
import { HookahCallsController } from "./hookah-calls.controller";
import { HookahCallsService } from "./hookah-calls.service";
import { HookahGuestAccessService } from "./hookah-guest-access.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([HookahCall, Booking, Staff, Restaurant]),
    NotificationsModule,
    WaiterCallsModule,
  ],
  controllers: [HookahCallsController],
  providers: [
    HookahCallsService,
    HookahGuestAccessService,
    HookahCallTelegramNotifierService,
  ],
  exports: [HookahCallsService],
})
export class HookahCallsModule {}
