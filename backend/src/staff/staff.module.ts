import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Staff } from './entities/staff.entity';
import { StaffShiftEvent } from './entities/staff-shift-event.entity';
import { StaffController } from './staff.controller';
import { StaffService } from './staff.service';

@Module({ imports: [TypeOrmModule.forFeature([Staff, StaffShiftEvent])], controllers: [StaffController], providers: [StaffService], exports: [StaffService], })
export class StaffModule {}
