import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AnalyticsModule } from './analytics/analytics.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { RolesGuard } from './auth/guards/roles.guard';
import { BookingsModule } from './bookings/bookings.module';
import { BroadcastsModule } from './broadcasts/broadcasts.module';
import { ClientsModule } from './clients/clients.module';
import { resolveDatabaseSynchronize } from './database/database-synchronize';
import { HookahCallsModule } from './hookah-calls/hookah-calls.module';
import { LogsModule } from './logs/logs.module';
import { MapModule } from './map/map.module';
import { CreateStaffPinAttempts2026081400010 } from './migrations/2026081400010-CreateStaffPinAttempts';
import { UpgradeStaffPinAttemptsPerAttempt2026081400020 } from './migrations/2026081400020-UpgradeStaffPinAttemptsPerAttempt';
import { CreateWaiterCalls2026081500010 } from './migrations/2026081500010-CreateWaiterCalls';
import { AddWaiterCallAssignmentActive2026081500015 } from './migrations/2026081500015-AddWaiterCallAssignmentActive';
import { CloseInactiveWaiterCalls2026081500020 } from './migrations/2026081500020-CloseInactiveWaiterCalls';
import { AddGuestReviewArchive2026082200010 } from './migrations/2026082200010-AddGuestReviewArchive';
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
    CreateWaiterCalls2026081500010,
    AddWaiterCallAssignmentActive2026081500015,
    CloseInactiveWaiterCalls2026081500020,
    AddGuestReviewArchive2026082200010,
  ],
};

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),

    ScheduleModule.forRoot(),

    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const databaseSynchronize = resolveDatabaseSynchronize(
          configService.get<string>('DB_SYNCHRONIZE'),
        );
        const dbUrl = configService.get<string>('DB_URL');

        return dbUrl
          ? {
              type: 'postgres' as const,
              url: dbUrl,
              ssl: {
                rejectUnauthorized: false,
              },
              extra: {
                ssl: {
                  rejectUnauthorized: false,
                },
              },
              autoLoadEntities: true,
              synchronize: databaseSynchronize,
              ...staffPinMigrationOptions,
            }
          : {
              type: 'postgres' as const,
              host: configService.get<string>('DB_HOST') || 'localhost',
              port: Number(configService.get<string>('DB_PORT') || 5432),
              username: configService.get<string>('DB_USER') || 'postgres',
              password:
                configService.get<string>('DB_PASSWORD') || 'postgres',
              database:
                configService.get<string>('DB_NAME') || 'molo_restaurant',
              autoLoadEntities: true,
              synchronize: databaseSynchronize,
              ...staffPinMigrationOptions,
            };
      },
    }),

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
