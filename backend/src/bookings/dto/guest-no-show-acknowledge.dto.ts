import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class GuestNoShowAcknowledgeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  guestDeviceId: string;
}
