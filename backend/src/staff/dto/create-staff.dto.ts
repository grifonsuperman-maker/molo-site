import { IsIn, IsOptional, IsString } from 'class-validator';

import { StaffRole } from '../entities/staff.entity';

export class CreateStaffDto {
  @IsString()
  fullName: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  telegramId?: string;

  @IsIn(['owner', 'admin', 'waiter'])
  role: StaffRole;
}
