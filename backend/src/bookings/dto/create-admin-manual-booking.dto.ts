import { OmitType } from '@nestjs/mapped-types';
import { IsNotEmpty, IsString } from 'class-validator';

import { CreateBookingDto } from './create-booking.dto';

export class CreateAdminManualBookingDto extends OmitType(CreateBookingDto, [
  'guestDeviceId',
  'tableId',
  'tableNumber',
  'seats',
] as const) {
  @IsString()
  @IsNotEmpty()
  tableId: string;
}
