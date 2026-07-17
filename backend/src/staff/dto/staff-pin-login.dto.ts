import { IsString, IsUUID, Matches } from 'class-validator';

export class StaffPinLoginDto {
  @IsUUID()
  staffId: string;

  @IsString()
  @Matches(/^\d{4,6}$/, {
    message: 'PIN має містити від 4 до 6 цифр',
  })
  pin: string;
}
