import { Transform } from 'class-transformer';
import { OmitType } from '@nestjs/mapped-types';
import { IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';

import {
  UKRAINE_PHONE_PATTERN,
  normalizeUkrainePhone,
} from '../guest-contact-validation';
import { CreateBookingDto } from './create-booking.dto';

export class CreateAdminManualBookingDto extends OmitType(CreateBookingDto, [
  'guestDeviceId',
  'tableId',
  'tableNumber',
  'seats',
  'phone',
] as const) {
  @IsString()
  @IsNotEmpty()
  tableId: string;

  @Transform(({ value }) => {
    const input = String(value ?? '').trim();
    return input ? (normalizeUkrainePhone(input) ?? input) : undefined;
  })
  @IsOptional()
  @IsString()
  @Matches(UKRAINE_PHONE_PATTERN, {
    message: 'Вкажіть телефон у форматі +380 (XX) XXX-XX-XX',
  })
  phone?: string;
}
