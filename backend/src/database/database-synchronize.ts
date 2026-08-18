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
