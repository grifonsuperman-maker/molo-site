import { IsOptional, IsString, MaxLength } from 'class-validator';

export class GuestCancelBookingDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
