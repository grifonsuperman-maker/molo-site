import { IsOptional, IsString } from 'class-validator';

export class CloseRestaurantDto {
  @IsOptional()
  @IsString()
  message?: string;
}
