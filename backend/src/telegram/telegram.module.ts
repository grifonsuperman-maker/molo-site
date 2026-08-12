import { Module } from '@nestjs/common';

import { BookingsModule } from '../bookings/bookings.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RestaurantModule } from '../restaurant/restaurant.module';
import { StaffModule } from '../staff/staff.module';
import { TelegramWebhookController } from './telegram-webhook.controller';
import { TelegramWebhookService } from './telegram-webhook.service';

@Module({
  imports: [BookingsModule, RestaurantModule, NotificationsModule, StaffModule],
  controllers: [TelegramWebhookController],
  providers: [TelegramWebhookService],
})
export class TelegramModule {}
