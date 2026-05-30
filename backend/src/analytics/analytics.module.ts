import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { Booking } from '../bookings/entities/booking.entity';
import { Client } from '../clients/entities/client.entity';
import { TableEntity } from '../tables/entities/table.entity';
import { Zone } from '../zones/entities/zone.entity';
@Module({ imports:[TypeOrmModule.forFeature([Booking,Client,TableEntity,Zone])], controllers:[AnalyticsController], providers:[AnalyticsService], exports:[AnalyticsService] })
export class AnalyticsModule {}
