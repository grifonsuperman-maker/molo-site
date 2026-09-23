import { Type } from 'class-transformer';
import {
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

const BASE64URL_VALUE = /^[A-Za-z0-9_-]+={0,2}$/;

export class GuestPushSubscriptionKeysDto {
  @IsString()
  @MaxLength(512)
  @Matches(BASE64URL_VALUE)
  p256dh: string;

  @IsString()
  @MaxLength(256)
  @Matches(BASE64URL_VALUE)
  auth: string;
}

export class GuestBrowserPushSubscriptionDto {
  @IsString()
  @MaxLength(4096)
  endpoint: string;

  // PushSubscription.toJSON() includes expirationTime (usually null).
  @IsOptional()
  @IsNumber()
  expirationTime?: number | null;

  @IsObject()
  @ValidateNested()
  @Type(() => GuestPushSubscriptionKeysDto)
  keys: GuestPushSubscriptionKeysDto;
}

export class RegisterGuestPushSubscriptionDto {
  @IsUUID()
  bookingId: string;

  @IsString()
  @MaxLength(256)
  guestAccessToken: string;

  @IsString()
  @MaxLength(256)
  guestDeviceId: string;

  @IsObject()
  @ValidateNested()
  @Type(() => GuestBrowserPushSubscriptionDto)
  subscription: GuestBrowserPushSubscriptionDto;
}
