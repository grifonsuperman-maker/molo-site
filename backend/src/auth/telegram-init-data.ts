import * as crypto from 'crypto';

export type ParsedTelegramUser = {
  id: string;
  firstName?: string;
  lastName?: string;
  username?: string;
};

export function verifyTelegramInitData(initData: string, botToken: string): ParsedTelegramUser {
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

  const userRaw = params.get('user');

  if (!userRaw) {
    throw new Error('Telegram user відсутній');
  }

  const user = JSON.parse(userRaw);

  return {
    id: String(user.id),
    firstName: user.first_name,
    lastName: user.last_name,
    username: user.username,
  };
}
