import { IsString, MaxLength, MinLength } from 'class-validator';

export class GuestReviewDto {
  @IsString()
  @MinLength(2)
  @MaxLength(2000)
  text: string;
}
