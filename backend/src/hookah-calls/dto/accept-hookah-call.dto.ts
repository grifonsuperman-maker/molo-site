import { IsIn, IsInt } from "class-validator";

export class AcceptHookahCallDto {
  @IsInt({ message: "Час очікування має бути цілим числом" })
  @IsIn([5, 10, 20, 30], { message: "Оберіть 5, 10, 20 або 30 хвилин" })
  etaMinutes: number;
}
