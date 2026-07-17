import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import type { StaffRole } from '../entities/staff.entity';

export class CreateStaffDto {
  @IsString()
  @MaxLength(120)
  fullName: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @IsString()
  telegramId?: string;

  @IsIn(['owner', 'admin', 'waiter', 'hookah'])
  role: StaffRole;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4,6}$/, { message: 'PIN має містити від 4 до 6 цифр', })
  pin?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
