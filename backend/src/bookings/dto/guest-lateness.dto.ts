import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

export class GuestLatenessDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(12)
  hours: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(59)
  minutes: number;
}
