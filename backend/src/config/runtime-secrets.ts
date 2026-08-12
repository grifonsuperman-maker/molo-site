type RuntimeEnv = Record<string, string | undefined>;

const DEVELOPMENT_JWT_SECRET = 'dev-secret-change-me';

function read(env: RuntimeEnv, key: string): string {
  return env[key]?.trim() || '';
}

export function isProductionRuntime(env: RuntimeEnv = process.env): boolean {
  return read(env, 'NODE_ENV') === 'production' || Boolean(read(env, 'RENDER_EXTERNAL_URL'));
}

export function resolveJwtSecret(env: RuntimeEnv = process.env): string {
  const configured = read(env, 'JWT_SECRET');
  if (configured) return configured;

  if (isProductionRuntime(env)) {
    throw new Error('JWT_SECRET is required in production');
  }

  return DEVELOPMENT_JWT_SECRET;
}

export function assertProductionSecrets(env: RuntimeEnv = process.env): void {
  if (!isProductionRuntime(env)) return;

  const required = ['JWT_SECRET', 'TELEGRAM_WEBHOOK_SECRET'];
  const missing = required.filter((key) => !read(env, key));

  if (missing.length > 0) {
    throw new Error(`Missing required production secrets: ${missing.join(', ')}`);
  }
}
