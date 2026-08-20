import { isProductionRuntime } from '../config/runtime-secrets';

type RuntimeEnv = Record<string, string | undefined>;

function read(env: RuntimeEnv, key: string): string {
  return env[key]?.trim() || '';
}

export function resolveDatabaseSynchronize(value: string | undefined): boolean {
  if (value === undefined) {
    return true;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') {
    return true;
  }
  if (normalized === 'false') {
    return false;
  }

  throw new Error('DB_SYNCHRONIZE must be "true" or "false" when set');
}

export function assertProductionDatabaseSynchronize(
  env: RuntimeEnv = process.env,
): void {
  if (!isProductionRuntime(env)) return;

  if (read(env, 'DB_SYNCHRONIZE').toLowerCase() !== 'false') {
    throw new Error('DB_SYNCHRONIZE must be "false" in production');
  }
}
