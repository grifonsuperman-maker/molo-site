import { IsIn, IsNumber, Min } from 'class-validator';
export class ExpandMapDto { @IsIn(['left','right','top','bottom']) direction:'left'|'right'|'top'|'bottom'; @IsNumber() @Min(1) amount:number; }
