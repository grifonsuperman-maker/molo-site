import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConstructorController } from './constructor.controller';
import { ConstructorService } from './constructor.service';
import { TableEntity } from '../tables/entities/table.entity';
import { Zone } from '../zones/entities/zone.entity';
import { Restaurant } from '../restaurant/entities/restaurant.entity';
import { MapObject } from './entities/map-object.entity';
import { LogsModule } from '../logs/logs.module';
@Module({ imports:[TypeOrmModule.forFeature([TableEntity,Zone,Restaurant,MapObject]), LogsModule], controllers:[ConstructorController], providers:[ConstructorService], exports:[ConstructorService] })
export class ConstructorModule {}
