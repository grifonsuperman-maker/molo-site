import { IsDateString, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Min } from 'class-validator';
export class CreateBookingDto {
  @IsUUID() tableId:string;
  @IsString() @IsNotEmpty() fullName:string;
  @IsString() @IsNotEmpty() phone:string;
  @IsDateString() bookingDate:string;
  @IsString() @IsNotEmpty() bookingTime:string;
  @IsInt() @Min(1) guestsCount:number;
  @IsOptional() @IsString() wishes?:string;
}
