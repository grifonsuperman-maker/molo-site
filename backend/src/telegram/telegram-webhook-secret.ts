import { UnauthorizedException } from '@nestjs/common';
import * as crypto from 'crypto';

import { isProductionRuntime } from '../config/runtime-secrets';

type RuntimeEnv = Record<string, string | undefined>;

export function assertTelegramWebhookSecret(
  receivedSecret?: string,
  configuredSecret = process.env.TELEGRAM_WEBHOOK_SECRET,
  env: RuntimeEnv = process.env,
) {
  if (!configuredSecret) {
    if (isProductionRuntime(env)) {
      throw new UnauthorizedException('Секрет Telegram webhook не налаштований');
    }
    return;
  }

  if (!receivedSecret) {
    throw new UnauthorizedException('Секрет Telegram webhook відсутній');
  }

  const received = Buffer.from(receivedSecret);
  const expected = Buffer.from(configuredSecret);

  if (
    received.length !== expected.length ||
    !crypto.timingSafeEqual(received, expected)
  ) {
    throw new UnauthorizedException('Секрет Telegram webhook невірний');
  }
}
