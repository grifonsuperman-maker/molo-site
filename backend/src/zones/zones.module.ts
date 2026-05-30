import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Zone } from './entities/zone.entity';
import { Restaurant } from '../restaurant/entities/restaurant.entity';
import { ZonesController } from './zones.controller';
import { ZonesService } from './zones.service';
@Module({ imports:[TypeOrmModule.forFeature([Zone, Restaurant])], controllers:[ZonesController], providers:[ZonesService], exports:[ZonesService] })
export class ZonesModule {}
