import { IsNumber, IsOptional, IsString, IsUUID } from 'class-validator';
export class CreateMapObjectDto {
  @IsString() objectType:string;
  @IsOptional() @IsString() name?:string;
  @IsOptional() @IsUUID() zoneId?:string;
  @IsOptional() @IsNumber() x?:number;
  @IsOptional() @IsNumber() y?:number;
  @IsOptional() @IsNumber() width?:number;
  @IsOptional() @IsNumber() height?:number;
  @IsOptional() @IsNumber() rotation?:number;
  @IsOptional() @IsString() color?:string;
}
