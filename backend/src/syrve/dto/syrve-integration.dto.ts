import {
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  MaxLength,
  MinLength,
  IsArray,
  ArrayMaxSize,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

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
  @IsUUID('all')
  organizationId: string;

  @IsString()
  @MinLength(1)
  @MaxLength(240)
  organizationName: string;

  @IsString()
  @MinLength(40)
  @MaxLength(2500)
  confirmationProof: string;

  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => ConfirmSyrvePairDto)
  pairs: ConfirmSyrvePairDto[];
}

export class ConfirmSyrvePairDto {
  @IsUUID('all')
  moloTableId: string;

  @IsUUID('all')
  syrveTableId: string;
}

export class PreviewSyrveTablesDto extends TestSyrveConnectionDto {
  @IsUUID('all')
  organizationId: string;
}

export class SyrveRevisionDto {
  @IsUUID('all')
  configurationRevision: string;
}

export class DisconnectSyrveDto extends SyrveRevisionDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

export class UpdateSyrveConnectionDto extends SyrveRevisionDto {
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
