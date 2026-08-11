import { Module } from '@nestjs/common';
import { TelegramWebhookController } from './telegram-webhook.controller';
import { TelegramWebhookService } from './telegram-webhook.service';
import { BookingsModule } from '../bookings/bookings.module';
import { RestaurantModule } from '../restaurant/restaurant.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { StaffModule } from '../staff/staff.module';

@Module({
  imports: [
    BookingsModule,
    RestaurantModule,
    NotificationsModule,
    StaffModule,
  ],
  controllers: [TelegramWebhookController],
  providers: [TelegramWebhookService],
})
export class TelegramModule {}
