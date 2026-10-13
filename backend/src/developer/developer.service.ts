import { BadRequestException, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { AuthUser } from '../auth/types/auth-user.type';
import {
  DEVELOPER_SESSION_SECONDS, DEVELOPER_TOKEN_AUDIENCE, DEVELOPER_TOKEN_ISSUER,
  readDeveloperAccess, verifyDeveloperToken,
} from './developer-access';
import { DeveloperLoginThrottle } from './developer-login-throttle';
import { DeveloperLoginDto } from './dto/developer-login.dto';

@Injectable()
export class DeveloperService {
  constructor(private readonly jwt: JwtService, private readonly throttle: DeveloperLoginThrottle) {}

  async login(dto: DeveloperLoginDto, address: string) {
    const access = readDeveloperAccess();
    if (!access) throw new ServiceUnavailableException('Вхід розробника поки не налаштовано.');
    if (Buffer.byteLength(dto.password, 'utf8') > 72) {
      throw new BadRequestException('Пароль надто довгий.');
    }
    this.throttle.reserve(address);
    const passwordMatches = await bcrypt.compare(dto.password, access.passwordHash);
    const digest = (value: string) => createHash('sha256').update(value).digest();
    const loginMatches = timingSafeEqual(digest(dto.login.toLowerCase()), digest(access.login));
    if (!passwordMatches || !loginMatches) throw new UnauthorizedException('Невірні дані входу.');

    const accessToken = await this.jwt.signAsync({
      sub: 'developer', role: 'developer', staffId: null, telegramId: '',
    }, {
      secret: access.signingKey, algorithm: 'HS256', expiresIn: DEVELOPER_SESSION_SECONDS,
      audience: DEVELOPER_TOKEN_AUDIENCE, issuer: DEVELOPER_TOKEN_ISSUER,
    });
    // Re-check configuration after password verification, so a simultaneous
    // access revocation/rotation cannot yield a reported successful login.
    const user = await verifyDeveloperToken(this.jwt, accessToken);
    return { accessToken, ...this.session(user) };
  }

  session(user: AuthUser) {
    const revision = process.env.RENDER_GIT_COMMIT || '';
    return {
      user: { role: 'developer' as const, name: 'Розробник' },
      sessionExpiresAt: user.developerSessionExpiresAt,
      version: /^[a-f0-9]{7,40}$/i.test(revision) ? revision.slice(0, 7) : null,
    };
  }
}
