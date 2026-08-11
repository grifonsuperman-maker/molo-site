export type TelegramMode = 'guest' | 'waiter' | 'hookah' | 'admin' | 'director';
export type TelegramAuthRole =
  | 'guest'
  | 'waiter'
  | 'hookah'
  | 'admin'
  | 'owner';

export type TelegramWebApp = {
  initData?: string;
  ready?: () => void;
  expand?: () => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
};

declare global {
  interface Window {
    Telegram?: {
      WebApp?: TelegramWebApp;
    };
  }
}

export function getTelegramWebApp() {
  return window.Telegram?.WebApp;
}

export function isTelegramMiniApp() {
  return Boolean(getTelegramWebApp()?.initData);
}

export function resolveTelegramMode(
  role: TelegramAuthRole,
  currentHash: string,
): TelegramMode | null {
  const explicitMode = currentHash.replace('#', '');
  if (explicitMode && explicitMode !== 'guest') return null;

  const modes: Record<TelegramAuthRole, TelegramMode> = {
    guest: 'guest',
    waiter: 'waiter',
    hookah: 'hookah',
    admin: 'admin',
    owner: 'director',
  };

  return modes[role];
}
