import { IsUUID } from 'class-validator';

export class CreateHookahCallDto {
  @IsUUID('4', {
    message: 'Некоректний ідентифікатор бронювання',
  })
  bookingId: string;
}
