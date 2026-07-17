export type AuthRole =
  | 'guest'
  | 'waiter'
  | 'hookah'
  | 'admin'
  | 'owner';

export type AuthUser = {
  sub: string;
  telegramId: string;
  role: AuthRole;
  staffId?: string | null;
  name?: string | null;
};
