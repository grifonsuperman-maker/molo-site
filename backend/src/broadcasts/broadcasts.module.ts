import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Broadcast } from './entities/broadcast.entity';
import { Client } from '../clients/entities/client.entity';
import { BroadcastsController } from './broadcasts.controller';
import { BroadcastsService } from './broadcasts.service';
import { LogsModule } from '../logs/logs.module';
@Module({ imports:[TypeOrmModule.forFeature([Broadcast,Client]), LogsModule], controllers:[BroadcastsController], providers:[BroadcastsService], exports:[BroadcastsService] })
export class BroadcastsModule {}
