import { OmitType } from '@nestjs/mapped-types';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

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

  @IsOptional()
  @IsString()
  phone?: string;
}
