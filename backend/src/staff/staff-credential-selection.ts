import type { Staff } from './entities/staff.entity';

// Ordinary reads, including nested staff in logs/broadcasts, must never load
// credentials. Only authentication and the sanitized staff management view
// explicitly opt in. Invite token hashes remain excluded even here.
export const STAFF_CREDENTIAL_FIELDS = [
  'pinHash', 'directorLoginName', 'directorPasswordHash',
  'directorCredentialsConfiguredAt', 'directorFailedLoginAttempts', 'directorLockedUntil',
] as const;

export const STAFF_WITH_CREDENTIALS_SELECT: (keyof Staff)[] = [
  'id', 'telegramId', 'telegramInviteExpiresAt', 'fullName', 'phone', 'role',
  ...STAFF_CREDENTIAL_FIELDS,
  'note', 'active', 'isArchived', 'isOnShift', 'shiftStartedAt', 'shiftStartedBy',
  'shiftEndedAt', 'shiftEndedBy', 'lastAutoShiftEndDate', 'archivedAt', 'archivedBy',
  'createdAt', 'updatedAt',
];
