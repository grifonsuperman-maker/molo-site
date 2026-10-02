import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { createDecipheriv, createHash } from 'crypto';
import { isProductionRuntime } from '../config/runtime-secrets';
import type { SyrveIntegration } from './entities/syrve-integration.entity';

export function syrveCredentialsKey() {
  const secret = process.env.SYRVE_CREDENTIALS_SECRET || (!isProductionRuntime() ? process.env.JWT_SECRET : undefined);
  if (!secret || secret.length < 16) throw new InternalServerErrorException('На сервері не налаштовано SYRVE_CREDENTIALS_SECRET');
  return createHash('sha256').update(secret).digest();
}
export function decryptSyrveCredentials(entity: SyrveIntegration) {
  if (!entity.apiLoginEncrypted || !entity.apiLoginIv || !entity.apiLoginAuthTag) throw new BadRequestException('Дані доступу Syrve ще не збережені');
  try {
    const decipher = createDecipheriv('aes-256-gcm', syrveCredentialsKey(), Buffer.from(entity.apiLoginIv, 'base64'));
    decipher.setAuthTag(Buffer.from(entity.apiLoginAuthTag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(entity.apiLoginEncrypted, 'base64')), decipher.final()]).toString('utf8');
  } catch { throw new InternalServerErrorException('Не вдалося розшифрувати дані доступу Syrve'); }
}
