import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { BookingsModule } from '../bookings/bookings.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RestaurantModule } from '../restaurant/restaurant.module';
import { Staff } from '../staff/entities/staff.entity';
import { TelegramWebhookController } from './telegram-webhook.controller';
import { TelegramWebhookService } from './telegram-webhook.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Staff]),
    BookingsModule,
    RestaurantModule,
    NotificationsModule,
  ],
  controllers: [TelegramWebhookController],
  providers: [TelegramWebhookService],
})
export class TelegramModule {}
