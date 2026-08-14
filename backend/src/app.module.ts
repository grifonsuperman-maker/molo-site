import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AnalyticsModule } from './analytics/analytics.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { RolesGuard } from './auth/guards/roles.guard';
import { BookingsModule } from './bookings/bookings.module';
import { BroadcastsModule } from './broadcasts/broadcasts.module';
import { ClientsModule } from './clients/clients.module';
import { HookahCallsModule } from './hookah-calls/hookah-calls.module';
import { LogsModule } from './logs/logs.module';
import { MapModule } from './map/map.module';
import { CreateStaffPinAttempts2026081400010 } from './migrations/2026081400010-CreateStaffPinAttempts';
import { UpgradeStaffPinAttemptsPerAttempt2026081400020 } from './migrations/2026081400020-UpgradeStaffPinAttemptsPerAttempt';
import { NotificationsModule } from './notifications/notifications.module';
import { RestaurantModule } from './restaurant/restaurant.module';
import { SchedulesModule } from './schedules/schedules.module';
import { StaffModule } from './staff/staff.module';
import { SyrveIntegrationModule } from './syrve/syrve-integration.module';
import { TablesModule } from './tables/tables.module';
import { TelegramModule } from './telegram/telegram.module';
import { WaiterCallsModule } from './waiter-calls/waiter-calls.module';
import { ZonesModule } from './zones/zones.module';

const staffPinMigrationOptions = {
  migrations: [
    CreateStaffPinAttempts2026081400010,
    UpgradeStaffPinAttemptsPerAttempt2026081400020,
  ],
};

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),

    ScheduleModule.forRoot(),

    TypeOrmModule.forRoot(
      process.env.DB_URL
        ? {
            type: 'postgres',
            url: process.env.DB_URL,
            ssl: {
              rejectUnauthorized: false,
            },
            extra: {
              ssl: {
                rejectUnauthorized: false,
              },
            },
            autoLoadEntities: true,
            synchronize: true,
            ...staffPinMigrationOptions,
          }
        : {
            type: 'postgres',
            host: process.env.DB_HOST || 'localhost',
            port: Number(process.env.DB_PORT || 5432),
            username: process.env.DB_USER || 'postgres',
            password: process.env.DB_PASSWORD || 'postgres',
            database: process.env.DB_NAME || 'molo_restaurant',
            autoLoadEntities: true,
            synchronize: true,
            ...staffPinMigrationOptions,
          },
    ),

    AuthModule,
    LogsModule,
    NotificationsModule,
    RestaurantModule,
    ZonesModule,
    TablesModule,
    ClientsModule,
    StaffModule,
    BookingsModule,
    MapModule,
    AnalyticsModule,
    BroadcastsModule,
    TelegramModule,
    SchedulesModule,
    WaiterCallsModule,
    HookahCallsModule,
    SyrveIntegrationModule,
  ],

  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
})
export class AppModule {}
