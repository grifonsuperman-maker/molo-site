import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class GuestChangeTableDto {
  @IsOptional()
  @IsUUID()
  tableId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  tableNumber?: string;
}
