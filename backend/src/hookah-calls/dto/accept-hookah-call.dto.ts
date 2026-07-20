import { IsIn, IsInt } from 'class-validator';

export class AcceptHookahCallDto {
  @IsInt({ message: 'Час очікування має бути цілим числом', })
  @IsIn([3, 10, 15, 20], { message: 'Оберіть 3, 10, 15 або 20 хвилин', })
  etaMinutes: number;
}
