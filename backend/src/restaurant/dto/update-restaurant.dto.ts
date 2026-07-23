import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';

export class UpdateRestaurantDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() phone?: string | null;
  @IsOptional() @IsBoolean() adminCanManageZones?: boolean;
  @IsOptional() @IsBoolean() adminCanManageOnlineBooking?: boolean;
  @IsOptional() @IsBoolean() adminCanManageRestaurant?: boolean;
  @IsOptional() @IsBoolean() adminCanChangeSiteMode?: boolean;
  @IsOptional() @IsBoolean() adminCanEditRestaurantSettings?: boolean;
  @IsOptional() @IsBoolean() adminCanManageBlacklist?: boolean;
  @IsOptional() @IsBoolean() adminCanRespondReviews?: boolean;
  @IsOptional() @IsBoolean() adminCanManageStaffShifts?: boolean;
  @IsOptional() @IsBoolean() adminCanSendBroadcasts?: boolean;
  @IsOptional() @IsString() address?: string | null;
  @IsOptional() @IsString() menuUrl?: string | null;
  @IsOptional() @IsString() logoUrl?: string | null;
  @IsOptional() @IsString() mainPhotoUrl?: string | null;
  @IsOptional() @IsString() openTime?: string;
  @IsOptional() @IsString() bookingCloseTime?: string;
  @IsOptional() @IsString() closeTime?: string;
  @IsOptional() @IsString() closeMessage?: string;
  @IsOptional() @IsString() bookingClosedMessage?: string;
  @IsOptional()
  @IsIn(['day', 'night', 'holiday'])
  siteMode?: 'day' | 'night' | 'holiday';

  @IsOptional()
  @IsIn([
    'new-year',
    'christmas',
    'valentines',
    'easter',
    'halloween',
    'march-8',
    null,
  ])
  holidayKey?:
    | 'new-year'
    | 'christmas'
    | 'valentines'
    | 'easter'
    | 'halloween'
    | 'march-8'
    | null;
}
