import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpdateDirectorAccessDto {
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  fullName: string;

  @IsString()
  @MinLength(3)
  @MaxLength(64)
  @Matches(/^\S+$/, {
    message: 'Ім’я для входу не повинно містити пробілів',
  })
  loginName: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  currentPassword?: string;

  @IsString()
  @MinLength(6)
  @MaxLength(128)
  newPassword: string;

  @IsString()
  @MinLength(6)
  @MaxLength(128)
  confirmPassword: string;
}
