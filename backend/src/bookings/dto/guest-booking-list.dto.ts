import { ArrayMaxSize, IsArray, IsOptional, IsString, MaxLength } from 'class-validator';

export class GuestBookingListDto {
  @IsOptional()
  @IsString()
  @MaxLength(256)
  guestDeviceId?: string;

  // Залишається для сумісності з бронюваннями, створеними до ідентифікатора пристрою.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(256, { each: true })
  tokens?: string[];
}
