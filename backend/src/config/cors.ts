import { isProductionRuntime } from './runtime-secrets';

type RuntimeEnv = Record<string, string | undefined>;

type CorsOriginCallback = (error: Error | null, allow?: boolean) => void;

function read(env: RuntimeEnv, key: string): string {
  return env[key]?.trim() || '';
}

function normalizeOrigin(value: string, source: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('unsupported protocol');
    }
    return url.origin;
  } catch {
    throw new Error(`Invalid ${source} origin: ${value}`);
  }
}

export function resolveProductionCorsOrigins(
  env: RuntimeEnv = process.env,
): string[] {
  if (!isProductionRuntime(env)) return [];

  const configured = read(env, 'CORS_ALLOWED_ORIGINS')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => normalizeOrigin(value, 'CORS_ALLOWED_ORIGINS'));

  const telegramWebAppUrl = read(env, 'TELEGRAM_WEB_APP_URL');
  if (telegramWebAppUrl) {
    configured.push(normalizeOrigin(telegramWebAppUrl, 'TELEGRAM_WEB_APP_URL'));
  }

  const origins = [...new Set(configured)];
  if (origins.length === 0) {
    throw new Error(
      'CORS_ALLOWED_ORIGINS or TELEGRAM_WEB_APP_URL is required in production',
    );
  }

  return origins;
}

export function buildCorsOptions(env: RuntimeEnv = process.env) {
  if (!isProductionRuntime(env)) {
    return { origin: true, credentials: true };
  }

  const allowedOrigins = new Set(resolveProductionCorsOrigins(env));

  return {
    credentials: true,
    origin(origin: string | undefined, callback: CorsOriginCallback) {
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`CORS origin is not allowed: ${origin}`), false);
    },
  };
}
