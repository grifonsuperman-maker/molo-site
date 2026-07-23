import { IsNotEmpty, IsString } from 'class-validator';

export class AdminChangeTableDto {
  @IsString()
  @IsNotEmpty()
  tableId: string;
}
