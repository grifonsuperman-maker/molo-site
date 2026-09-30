import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Zone } from './entities/zone.entity';
import { Restaurant } from '../restaurant/entities/restaurant.entity';
import { TableEntity } from '../tables/entities/table.entity';
import { ZonesController } from './zones.controller';
import { ZonesService } from './zones.service';
import { TableMapIdentityModule } from '../tables/table-map-identity.module';

@Module({
  imports: [TypeOrmModule.forFeature([Zone, Restaurant, TableEntity]), TableMapIdentityModule],
  controllers: [ZonesController],
  providers: [ZonesService],
  exports: [ZonesService],
})
export class ZonesModule {}
