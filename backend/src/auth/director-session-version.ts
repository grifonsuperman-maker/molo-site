import type { Staff } from '../staff/entities/staff.entity';

// Use the existing persisted credentials timestamp as a per-Director session
// version. Millisecond precision distinguishes tokens issued before/after an
// access change without adding a new database column or affecting other roles.
export function directorSessionVersion(
  staff: Pick<Staff, 'directorCredentialsConfiguredAt'>,
): number {
  return staff.directorCredentialsConfiguredAt?.getTime() ?? 0;
}

export function nextDirectorCredentialsTimestamp(
  previous: Date | null,
  now = Date.now(),
): Date {
  return new Date(Math.max(now, (previous?.getTime() ?? 0) + 1));
}
