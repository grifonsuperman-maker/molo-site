import { IsArray, IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import { BroadcastTarget } from '../entities/broadcast.entity';
export class CreateBroadcastDto {
  @IsOptional() @IsString() title?:string;
  @IsString() message:string;
  @IsIn(['all_clients','regular_clients','recent_clients','selected_clients']) target:BroadcastTarget;
  @IsOptional() @IsArray() @IsUUID('4',{each:true}) clientIds?:string[];
}
