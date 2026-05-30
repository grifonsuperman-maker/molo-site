import { IsDateString, IsNotEmpty, IsString } from 'class-validator';
export class RequestRescheduleDto { @IsDateString() requestedDate:string; @IsString() @IsNotEmpty() requestedTime:string; }
