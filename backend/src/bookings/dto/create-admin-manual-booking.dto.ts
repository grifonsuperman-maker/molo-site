import { OmitType } from '@nestjs/mapped-types';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

import { GuestPhone } from '../../common/validation/guest-contact';
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
  @GuestPhone(true)
  phone?: string;
}
