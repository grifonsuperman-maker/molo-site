import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Restaurant } from './entities/restaurant.entity';
import { RestaurantController } from './restaurant.controller';
import { RestaurantService } from './restaurant.service';
import { LogsModule } from '../logs/logs.module';
@Module({ imports:[TypeOrmModule.forFeature([Restaurant]), LogsModule], controllers:[RestaurantController], providers:[RestaurantService], exports:[RestaurantService] })
export class RestaurantModule {}
