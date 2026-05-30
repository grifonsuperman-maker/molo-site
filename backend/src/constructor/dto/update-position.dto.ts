import { IsNumber, IsOptional } from 'class-validator';
export class UpdatePositionDto { @IsNumber() x:number; @IsNumber() y:number; @IsOptional() @IsNumber() rotation?:number; }
