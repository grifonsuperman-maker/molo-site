export type AuthRole =
  | 'guest'
  | 'waiter'
  | 'hookah'
  | 'admin'
  | 'owner'
  | 'developer';

export type AuthUser = {
  sub: string;
  telegramId: string;
  role: AuthRole;
  staffId?: string | null;
  name?: string | null;
  directorSessionVersion?: number;
  developerSessionExpiresAt?: string;
};
