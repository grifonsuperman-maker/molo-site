import {
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator';

export class TestSyrveConnectionDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  displayName: string;

  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(500)
  apiBaseUrl: string;

  @IsString()
  @MinLength(5)
  @MaxLength(1000)
  apiLogin: string;
}

export class ConnectSyrveDto extends TestSyrveConnectionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  organizationId: string;

  @IsString()
  @MinLength(1)
  @MaxLength(240)
  organizationName: string;
}

export class UpdateSyrveConnectionDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  displayName?: string;

  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(500)
  apiBaseUrl?: string;
}
