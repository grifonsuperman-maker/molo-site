import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TableEntity } from './entities/table.entity';
import { Zone } from '../zones/entities/zone.entity';
import { TablesController } from './tables.controller';
import { TablesService } from './tables.service';
@Module({ imports:[TypeOrmModule.forFeature([TableEntity, Zone])], controllers:[TablesController], providers:[TablesService], exports:[TablesService] })
export class TablesModule {}
