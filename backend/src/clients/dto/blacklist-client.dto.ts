import { IsOptional, IsString, MaxLength } from 'class-validator';

export class BlacklistClientDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}
