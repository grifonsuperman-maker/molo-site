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

export class CreateBookingDto {
  // Якщо стіл вже є в базі, frontend передасть uuid.
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

  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  guestDeviceId: string;

  @IsDateString()
  bookingDate: string;

  @IsString()
  @IsNotEmpty()
  bookingTime: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  guestsCount: number;

  // Тимчасово backend приймає durationMinutes, але зберігає час у wishes.
  // Так бронювання не ламається, навіть якщо база ще без нових колонок.
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
