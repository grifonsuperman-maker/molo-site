import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export class CheckAvailabilityDto {
  @IsUUID()
  tableId: string;

  @IsDateString()
  bookingDate: string;

  @IsString()
  @IsNotEmpty()
  bookingTime: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(30)
  @Max(720)
  durationMinutes?: number;
}
