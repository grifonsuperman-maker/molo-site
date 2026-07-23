import { IsDateString, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

export class CreateAvailabilityBlockDto {
  @IsOptional()
  @IsUUID()
  tableId?: string;

  @IsOptional()
  @IsUUID()
  zoneId?: string;

  @IsDateString()
  blockDate: string;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  startTime?: string;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  endTime?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}
