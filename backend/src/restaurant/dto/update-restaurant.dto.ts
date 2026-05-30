import { IsOptional, IsString } from 'class-validator';
export class UpdateRestaurantDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() menuUrl?: string;
  @IsOptional() @IsString() logoUrl?: string;
  @IsOptional() @IsString() mainPhotoUrl?: string;
  @IsOptional() @IsString() openTime?: string;
  @IsOptional() @IsString() bookingCloseTime?: string;
  @IsOptional() @IsString() closeTime?: string;
  @IsOptional() @IsString() closeMessage?: string;
  @IsOptional() @IsString() bookingClosedMessage?: string;
}
