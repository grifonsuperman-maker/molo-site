import { IsOptional, IsString, MaxLength } from 'class-validator';

export class StaffShiftActionDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  performedBy?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}
