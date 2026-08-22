import { Module } from '@nestjs/common';

import { AnalyticsModule } from '../analytics/analytics.module';
import { BookingsModule } from '../bookings/bookings.module';
import { BroadcastsModule } from '../broadcasts/broadcasts.module';
import { HookahCallsModule } from '../hookah-calls/hookah-calls.module';
import { LogsModule } from '../logs/logs.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RestaurantModule } from '../restaurant/restaurant.module';
import { StaffModule } from '../staff/staff.module';
import { TablesModule } from '../tables/tables.module';
import { WaiterCallsModule } from '../waiter-calls/waiter-calls.module';
import { TelegramAdminMenuService } from './telegram-admin-menu.service';
import { TelegramDirectorMenuService } from './telegram-director-menu.service';
import { TelegramHookahMenuService } from './telegram-hookah-menu.service';
import { TelegramWaiterAssignmentLookupService } from './telegram-waiter-assignment-lookup.service';
import { TelegramWaiterMenuResolvedService } from './telegram-waiter-menu-resolved.service';
import { TelegramWaiterMenuService } from './telegram-waiter-menu.service';
import { TelegramWebhookController } from './telegram-webhook.controller';
import { TelegramWebhookService } from './telegram-webhook.service';

@Module({
  imports: [
    AnalyticsModule,
    BookingsModule,
    BroadcastsModule,
    HookahCallsModule,
    LogsModule,
    RestaurantModule,
    NotificationsModule,
    StaffModule,
    TablesModule,
    WaiterCallsModule,
  ],
  controllers: [TelegramWebhookController],
  providers: [
    TelegramWebhookService,
    TelegramAdminMenuService,
    TelegramDirectorMenuService,
    TelegramHookahMenuService,
    TelegramWaiterAssignmentLookupService,
    TelegramWaiterMenuResolvedService,
    {
      provide: TelegramWaiterMenuService,
      useExisting: TelegramWaiterMenuResolvedService,
    },
  ],
})
export class TelegramModule {}
