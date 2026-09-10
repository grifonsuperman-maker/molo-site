import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { GuestName, GuestPhone } from '../../common/validation/guest-contact';

export class UpdateClientDto {
  @IsOptional() @GuestName() fullName?: string;
  @IsOptional() @GuestPhone() phone?: string;
  @IsOptional() @IsString() note?: string;
  @IsOptional() @IsBoolean() isRegular?: boolean;
}
