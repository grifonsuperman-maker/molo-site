import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHmac } from 'node:crypto';
import type { AuthUser } from '../auth/types/auth-user.type';
import { resolveJwtSecret } from '../config/runtime-secrets';

export const DEVELOPER_SESSION_SECONDS = 15 * 60;
export const DEVELOPER_TOKEN_AUDIENCE = 'molo:developer-console';
export const DEVELOPER_TOKEN_ISSUER = 'molo:developer-access';

type RuntimeEnv = Record<string, string | undefined>;
export type DeveloperAccess = { login: string; passwordHash: string; signingKey: string };

// Optional configuration fails closed without adding a production startup
// requirement or reading/writing the Staff table.
export function readDeveloperAccess(env: RuntimeEnv = process.env): DeveloperAccess | null {
  if (env.DEVELOPER_ACCESS_ENABLED !== 'true') return null;
  const login = (env.DEVELOPER_LOGIN || '').trim().toLowerCase();
  const passwordHash = (env.DEVELOPER_PASSWORD_HASH || '').trim();
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(login)) return null;
  if (!/^\$2[aby]\$(12|13|14)\$[./A-Za-z0-9]{53}$/.test(passwordHash)) return null;

  // Credentials never enter the token. Rotation of either credential changes
  // this domain-separated signing key and revokes previously issued sessions.
  const signingKey = createHmac('sha256', resolveJwtSecret(env))
    .update(JSON.stringify([DEVELOPER_TOKEN_AUDIENCE, login, passwordHash]))
    .digest('base64url');
  return { login, passwordHash, signingKey };
}

export async function verifyDeveloperToken(jwt: JwtService, token: string): Promise<AuthUser> {
  const access = readDeveloperAccess();
  if (!access) throw new UnauthorizedException('Недійсний вхід розробника');
  const claims = await jwt.verifyAsync<AuthUser & { iat: number; exp: number }>(token, {
    secret: access.signingKey,
    algorithms: ['HS256'],
    audience: DEVELOPER_TOKEN_AUDIENCE,
    issuer: DEVELOPER_TOKEN_ISSUER,
  });
  if (
    claims.role !== 'developer' || claims.sub !== 'developer' ||
    claims.staffId !== null || claims.telegramId !== '' ||
    !Number.isInteger(claims.iat) || !Number.isInteger(claims.exp) ||
    claims.iat > Math.floor(Date.now() / 1000) ||
    claims.exp <= claims.iat || claims.exp - claims.iat > DEVELOPER_SESSION_SECONDS
  ) throw new UnauthorizedException('Недійсний вхід розробника');

  return {
    sub: 'developer', role: 'developer', staffId: null, telegramId: '',
    name: 'Розробник', developerSessionExpiresAt: new Date(claims.exp * 1000).toISOString(),
  };
}
