import { IsOptional, IsString, Matches, MinLength } from 'class-validator';

export class TelegramStaffLinkTokenDto {
  @IsString()
  token: string;
}

export class ConfirmTelegramStaffLinkDto {
  @IsString()
  token: string;

  @IsString()
  initData: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4,6}$/, {
    message: 'PIN має містити від 4 до 6 цифр',
  })
  pin?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  password?: string;
}
