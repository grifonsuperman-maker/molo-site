import * as crypto from 'crypto';

export type ParsedTelegramUser = {
  id: string;
  firstName?: string;
  lastName?: string;
  username?: string;
};

export const DEFAULT_TELEGRAM_INIT_DATA_MAX_AGE_SECONDS = 60 * 60;

type TelegramInitDataVerificationOptions = {
  maxAgeSeconds?: number;
  nowSeconds?: number;
};

export function verifyTelegramInitData(
  initData: string,
  botToken: string,
  options: TelegramInitDataVerificationOptions = {},
): ParsedTelegramUser {
  const params = new URLSearchParams(initData);
  const receivedHash = params.get('hash');

  if (!receivedHash) {
    throw new Error('Telegram hash відсутній');
  }

  params.delete('hash');

  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = crypto
    .createHmac('sha256', 'WebAppData')
    .update(botToken)
    .digest();

  const calculatedHash = crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  const receivedBuffer = Buffer.from(receivedHash, 'hex');
  const calculatedBuffer = Buffer.from(calculatedHash, 'hex');

  if (
    receivedBuffer.length !== calculatedBuffer.length ||
    !crypto.timingSafeEqual(receivedBuffer, calculatedBuffer)
  ) {
    throw new Error('Telegram initData не пройшов перевірку');
  }

  const authDate = Number(params.get('auth_date'));
  const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const maxAgeSeconds =
    options.maxAgeSeconds ?? DEFAULT_TELEGRAM_INIT_DATA_MAX_AGE_SECONDS;

  if (!Number.isInteger(authDate) || authDate <= 0) {
    throw new Error('Telegram auth_date відсутній або некоректний');
  }

  if (authDate > nowSeconds + 30) {
    throw new Error('Telegram initData має некоректний час');
  }

  if (nowSeconds - authDate > maxAgeSeconds) {
    throw new Error('Telegram initData застарів, відкрийте застосунок повторно');
  }

  const userRaw = params.get('user');

  if (!userRaw) {
    throw new Error('Telegram user відсутній');
  }

  let user: Record<string, unknown>;

  try {
    user = JSON.parse(userRaw);
  } catch {
    throw new Error('Telegram user має некоректний формат');
  }

  if (!user.id) {
    throw new Error('Telegram user id відсутній');
  }

  return {
    id: String(user.id),
    firstName: typeof user.first_name === 'string' ? user.first_name : undefined,
    lastName: typeof user.last_name === 'string' ? user.last_name : undefined,
    username: typeof user.username === 'string' ? user.username : undefined,
  };
}
