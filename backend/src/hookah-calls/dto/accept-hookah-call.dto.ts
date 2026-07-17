import { IsInt, Max, Min } from 'class-validator';

export class AcceptHookahCallDto {
  @IsInt({ message: 'Час очікування має бути цілим числом', })
  @Min(1, { message: 'Мінімальний час очікування — 1 хвилина', })
  @Max(120, { message: 'Максимальний час очікування — 120 хвилин', })
  etaMinutes: number;
}
