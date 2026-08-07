import { IsBoolean } from "class-validator";

export class UpdateHookahAvailabilityDto {
  @IsBoolean({ message: "Стан доступності має бути логічним значенням" })
  available: boolean;
}
