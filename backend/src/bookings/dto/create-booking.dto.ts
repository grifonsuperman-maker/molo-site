import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class CreateBookingDto {
  // Якщо стіл вже є в базі, frontend передасть його uuid.
  // Якщо це поки тільки SVG-стіл, frontend передасть visual-15 + tableNumber.
  @IsOptional()
  @IsString()
  tableId?: string;

  @IsOptional()
  @IsString()
  tableNumber?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  seats?: number;

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
