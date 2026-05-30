import { IsBoolean, IsNumber, IsOptional, IsString } from 'class-validator';
export class CreateZoneDto {
  @IsString() name: string;
  @IsOptional() @IsString() color?: string;
  @IsOptional() @IsString() photoUrl?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsNumber() x?: number;
  @IsOptional() @IsNumber() y?: number;
  @IsOptional() @IsNumber() width?: number;
  @IsOptional() @IsNumber() height?: number;
  @IsOptional() @IsNumber() rotation?: number;
  @IsOptional() @IsBoolean() isVisible?: boolean;
}
