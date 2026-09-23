import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Booking } from '../bookings/entities/booking.entity';
import { GuestPushSubscription } from './entities/guest-push-subscription.entity';
import { GuestPushController } from './guest-push.controller';
import { GuestPushService } from './guest-push.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      GuestPushSubscription,
      Booking,
    ]),
  ],
  controllers: [GuestPushController],
  providers: [GuestPushService],
  exports: [GuestPushService],
})
export class GuestPushModule {}
