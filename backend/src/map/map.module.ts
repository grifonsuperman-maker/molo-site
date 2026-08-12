import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Restaurant } from '../restaurant/entities/restaurant.entity';
import { TableEntity } from '../tables/entities/table.entity';
import { Zone } from '../zones/entities/zone.entity';
import { MapObject } from './entities/map-object.entity';
import {
  LegacyMapCompatibilityController,
  MapController,
} from './map.controller';
import { MapService } from './map.service';

@Module({
  imports: [TypeOrmModule.forFeature([TableEntity, Zone, Restaurant, MapObject])],
  controllers: [MapController, LegacyMapCompatibilityController],
  providers: [MapService],
  exports: [MapService],
})
export class MapModule {}
