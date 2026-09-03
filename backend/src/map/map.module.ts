import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { RestaurantModule } from '../restaurant/restaurant.module';
import { TableEntity } from '../tables/entities/table.entity';
import { Zone } from '../zones/entities/zone.entity';
import { MapObject } from './entities/map-object.entity';
import { MapController } from './map.controller';
import { MapService } from './map.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([TableEntity, Zone, MapObject]),
    RestaurantModule,
  ],
  controllers: [MapController],
  providers: [MapService],
  exports: [MapService],
})
export class MapModule {}
