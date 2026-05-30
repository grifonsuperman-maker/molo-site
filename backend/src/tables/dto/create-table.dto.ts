import { IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';
export class CreateTableDto {
  @IsOptional() @IsUUID() zoneId?: string;
  @IsString() tableNumber: string;
  @IsNumber() @Min(1) seats: number;
  @IsOptional() @IsString() shape?: string;
  @IsOptional() @IsString() photoUrl?: string;
  @IsOptional() @IsNumber() x?: number;
  @IsOptional() @IsNumber() y?: number;
  @IsOptional() @IsNumber() width?: number;
  @IsOptional() @IsNumber() height?: number;
  @IsOptional() @IsNumber() rotation?: number;
}
