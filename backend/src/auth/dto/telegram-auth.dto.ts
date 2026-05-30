import { IsOptional, IsString } from 'class-validator';

export class TelegramAuthDto {
  @IsOptional()
  @IsString()
  initData?: string;

  // Тільки для локального тестування, якщо ALLOW_DEV_AUTH=true
  @IsOptional()
  @IsString()
  devTelegramId?: string;

  @IsOptional()
  @IsString()
  devName?: string;
}
