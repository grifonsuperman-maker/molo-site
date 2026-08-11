import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RestaurantModule } from '../restaurant/restaurant.module';
import { StaffBootstrapService } from './staff-bootstrap.service';
import { StaffController } from './staff.controller';
import { StaffService } from './staff.service';
import { TelegramStaffLinkService } from './telegram-staff-link.service';
import { Staff } from './entities/staff.entity';
import { StaffShiftEvent } from './entities/staff-shift-event.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Staff, StaffShiftEvent]),
    AuthModule,
    NotificationsModule,
    RestaurantModule,
  ],
  controllers: [StaffController],
  providers: [
    StaffService,
    StaffBootstrapService,
    TelegramStaffLinkService,
  ],
  exports: [StaffService, TelegramStaffLinkService],
})
export class StaffModule {}
