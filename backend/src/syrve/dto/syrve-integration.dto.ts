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
  IsBoolean,
  Equals,
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

export class SyrveBillDiagnosticsDto extends SyrveRevisionDto {
  @IsUUID('all')
  orderId: string;
}

export class SyrvePosBillDiagnosticsDto extends SyrveBillDiagnosticsDto {
  @IsUUID('all')
  terminalGroupId: string;

  @IsBoolean()
  @Equals(true)
  confirmed: boolean;
}

export class ConfirmSyrveTableLoadingDto extends SyrveRevisionDto {
  @IsString()
  @MinLength(40)
  @MaxLength(1500)
  confirmationProof: string;

  @IsBoolean()
  @Equals(true)
  confirmed: boolean;
}

export class DisconnectSyrveDto extends SyrveRevisionDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

export class EnableSyrveAutoStatusDto extends ConfirmSyrveTableLoadingDto {
  @IsOptional()
  @IsBoolean()
  reconcileOpenTables?: boolean;
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
