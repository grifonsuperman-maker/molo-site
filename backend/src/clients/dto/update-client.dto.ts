import { IsBoolean, IsOptional, IsString } from 'class-validator';
export class UpdateClientDto {
  @IsOptional() @IsString() fullName?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() note?: string;
  @IsOptional() @IsBoolean() isRegular?: boolean;
  @IsOptional() @IsBoolean() isBlacklisted?: boolean;
}
