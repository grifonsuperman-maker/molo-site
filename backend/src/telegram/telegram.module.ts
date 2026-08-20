import { Module } from '@nestjs/common';

import { BookingsModule } from '../bookings/bookings.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RestaurantModule } from '../restaurant/restaurant.module';
import { StaffModule } from '../staff/staff.module';
import { TablesModule } from '../tables/tables.module';
import { WaiterCallsModule } from '../waiter-calls/waiter-calls.module';
import { TelegramWaiterMenuService } from './telegram-waiter-menu.service';
import { TelegramWebhookController } from './telegram-webhook.controller';
import { TelegramWebhookService } from './telegram-webhook.service';

@Module({
  imports: [
    BookingsModule,
    RestaurantModule,
    NotificationsModule,
    StaffModule,
    TablesModule,
    WaiterCallsModule,
  ],
  controllers: [TelegramWebhookController],
  providers: [TelegramWebhookService, TelegramWaiterMenuService],
})
export class TelegramModule {}
