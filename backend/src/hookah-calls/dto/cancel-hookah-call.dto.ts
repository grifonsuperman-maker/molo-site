import { IsString, MaxLength, MinLength } from 'class-validator';

export class CancelHookahCallDto {
  @IsString({ message: 'Причина скасування має бути текстом', })
  @MinLength(3, { message: 'Вкажіть причину скасування', })
  @MaxLength(500, { message: 'Причина скасування занадто довга', })
  reason: string;
}
