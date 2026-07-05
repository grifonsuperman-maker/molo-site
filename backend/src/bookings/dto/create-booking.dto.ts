import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export class CreateBookingDto {
  @IsUUID()
  tableId: string;

  @IsString()
  @IsNotEmpty()
  fullName: string;

  @IsString()
  @IsNotEmpty()
  phone: string;

  @IsDateString()
  bookingDate: string;

  @IsString()
  @IsNotEmpty()
  bookingTime: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  guestsCount: number;

  // Скільки гість планує відпочивати.
  // За замовчуванням 2 години. Максимум 12 годин, щоб "свій час" теж працював.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(30)
  @Max(720)
  durationMinutes?: number;

  @IsOptional()
  @IsString()
  wishes?: string;
}
