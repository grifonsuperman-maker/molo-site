import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Booking } from '../bookings/entities/booking.entity';
import { TableEntity } from './entities/table.entity';
import { Zone } from '../zones/entities/zone.entity';
import { TablesController } from './tables.controller';
import { TablesService } from './tables.service';
import { TableMapIdentityModule } from './table-map-identity.module';
import { SyrveStaffActionsModule } from '../syrve/syrve-staff-actions.module';
import { TableStatusProjectionModule } from './table-status-projection.module';

@Module({
  imports: [TypeOrmModule.forFeature([TableEntity, Zone, Booking]), TableMapIdentityModule, SyrveStaffActionsModule, TableStatusProjectionModule],
  controllers: [TablesController],
  providers: [TablesService],
  exports: [TablesService],
})
export class TablesModule {}
