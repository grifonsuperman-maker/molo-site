import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { LogsModule } from '../logs/logs.module';
import { AdminPermissionsService } from './admin-permissions.service';
import { Restaurant } from './entities/restaurant.entity';
import { RestaurantController } from './restaurant.controller';
import { RestaurantService } from './restaurant.service';

@Module({
  imports: [TypeOrmModule.forFeature([Restaurant]), LogsModule],
  controllers: [RestaurantController],
  providers: [RestaurantService, AdminPermissionsService],
  exports: [RestaurantService, AdminPermissionsService],
})
export class RestaurantModule {}
