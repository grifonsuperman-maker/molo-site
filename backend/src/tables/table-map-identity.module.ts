import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { TableMapIdentity } from './entities/table-map-identity.entity';
import { TableMapIdentityService } from './table-map-identity.service';

@Module({
  imports: [TypeOrmModule.forFeature([TableMapIdentity])],
  providers: [TableMapIdentityService],
  exports: [TableMapIdentityService],
})
export class TableMapIdentityModule {}
