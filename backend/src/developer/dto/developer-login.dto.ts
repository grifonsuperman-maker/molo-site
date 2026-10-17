import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class DeveloperLoginDto {
  @IsString()
  @Matches(/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,63}$/, { message: 'Введіть коректний логін.' })
  login: string;

  @IsString()
  @MinLength(16, { message: 'Пароль має містити щонайменше 16 символів.' })
  @MaxLength(72, { message: 'Пароль надто довгий.' })
  password: string;
}
