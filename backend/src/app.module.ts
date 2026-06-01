import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';

import { RestaurantModule } from './restaurant/restaurant.module';
import { ZonesModule } from './zones/zones.module';
import { TablesModule } from './tables/tables.module';
import { ClientsModule } from './clients/clients.module';
import { StaffModule } from './staff/staff.module';
import { LogsModule } from './logs/logs.module';
import { BookingsModule } from './bookings/bookings.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ConstructorModule } from './constructor/constructor.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { BroadcastsModule } from './broadcasts/broadcasts.module';
import { TelegramModule } from './telegram/telegram.module';
import { SchedulesModule } from './schedules/schedules.module';

import { RolesGuard } from './auth/guards/roles.guard';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),

    ScheduleModule.forRoot(),

    TypeOrmModule.forRoot(
      process.env.DB_URL
        ? {
            type: 'postgres',
            url: process.env.DB_URL,
            ssl: { rejectUnauthorized: false },
            extra: {
              ssl: { rejectUnauthorized: false },
            },
            autoLoadEntities: true,

            // ВРЕМЕННО: создаёт таблицы в базе автоматически
            synchronize: true,
          }
        : {
            type: 'postgres',
            host: process.env.DB_HOST || 'localhost',
            port: Number(process.env.DB_PORT || 5432),
            username: process.env.DB_USER || 'postgres',
            password: process.env.DB_PASSWORD || 'postgres',
            database: process.env.DB_NAME || 'molo_restaurant',
            autoLoadEntities: true,

            // ВРЕМЕННО: создаёт таблицы в базе автоматически
            synchronize: true,
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
    ConstructorModule,
    AnalyticsModule,
    BroadcastsModule,
    TelegramModule,
    SchedulesModule,
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
