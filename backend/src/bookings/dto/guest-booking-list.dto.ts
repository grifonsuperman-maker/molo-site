import { ArrayMaxSize, IsArray, IsString, MaxLength } from 'class-validator';

export class GuestBookingListDto {
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(256, { each: true })
  tokens: string[];
}
