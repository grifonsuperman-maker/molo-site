import { OmitType } from '@nestjs/mapped-types';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsUUID,
} from 'class-validator';

import { CreateAdminManualBookingDto } from './create-admin-manual-booking.dto';

export class CreateAdminBanquetBookingDto extends OmitType(
  CreateAdminManualBookingDto,
  ['tableId'] as const,
) {
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  tableIds: string[];

  @IsUUID()
  primaryTableId: string;
}
