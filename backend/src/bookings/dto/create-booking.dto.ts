import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import {
  GUEST_NAME_PATTERN,
  UKRAINE_PHONE_PATTERN,
  normalizeGuestName,
  normalizeUkrainePhone,
} from '../guest-contact-validation';

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

  @Transform(({ value }) => normalizeGuestName(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  @Matches(GUEST_NAME_PATTERN, {
    message: 'Ім’я може містити лише літери, пробіли, дефіс та апостроф',
  })
  fullName: string;

  @Transform(({ value }) =>
    normalizeUkrainePhone(value) ?? String(value ?? '').trim(),
  )
  @IsString()
  @IsNotEmpty()
  @Matches(UKRAINE_PHONE_PATTERN, {
    message: 'Вкажіть телефон у форматі +380 (XX) XXX-XX-XX',
  })
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
