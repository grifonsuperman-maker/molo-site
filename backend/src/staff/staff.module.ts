import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { StaffBootstrapService } from './staff-bootstrap.service';
import { StaffController } from './staff.controller';
import { StaffService } from './staff.service';
import { Staff } from './entities/staff.entity';
import { StaffShiftEvent } from './entities/staff-shift-event.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Staff, StaffShiftEvent]),
    AuthModule,
  ],
  controllers: [StaffController],
  providers: [StaffService, StaffBootstrapService],
  exports: [StaffService],
})
export class StaffModule {}
