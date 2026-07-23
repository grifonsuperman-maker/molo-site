import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateAdminBookingDto {
  @IsOptional()
  @IsString()
  tableId?: string;

  @IsOptional()
  @IsString()
  tableNumber?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  fullName: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  phone: string;

  @IsDateString()
  bookingDate: string;

  @IsString()
  @IsNotEmpty()
  bookingTime: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  guestsCount: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(30)
  @Max(720)
  durationMinutes?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  wishes?: string;
}
