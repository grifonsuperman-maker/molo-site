import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class ChangeBlacklistDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}
