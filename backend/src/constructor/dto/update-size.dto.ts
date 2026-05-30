import { IsNumber } from 'class-validator';
export class UpdateSizeDto { @IsNumber() width:number; @IsNumber() height:number; }
