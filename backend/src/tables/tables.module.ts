import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Booking } from '../bookings/entities/booking.entity';
import { TableEntity } from './entities/table.entity';
import { Zone } from '../zones/entities/zone.entity';
import { createProtectedTablesService } from './protected-tables.provider';
import { TablesController } from './tables.controller';
import { TablesService } from './tables.service';

const RAW_TABLES_SERVICE = Symbol('RAW_TABLES_SERVICE');

@Module({
  imports: [TypeOrmModule.forFeature([TableEntity, Zone, Booking])],
  controllers: [TablesController],
  providers: [
    { provide: RAW_TABLES_SERVICE, useClass: TablesService },
    {
      provide: TablesService,
      useFactory: (raw: TablesService, dataSource: DataSource) =>
        createProtectedTablesService(raw, dataSource),
      inject: [RAW_TABLES_SERVICE, DataSource],
    },
  ],
  exports: [TablesService],
})
export class TablesModule {}
