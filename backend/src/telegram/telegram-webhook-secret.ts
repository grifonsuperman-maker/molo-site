import { UnauthorizedException } from '@nestjs/common';
import * as crypto from 'crypto';

export function assertTelegramWebhookSecret(
  receivedSecret?: string,
  configuredSecret = process.env.TELEGRAM_WEBHOOK_SECRET,
) {
  // Під час поточного тестового етапу webhook лишається доступним без секрету.
  // Щойно секрет налаштований, кожен запит Telegram має його містити.
  if (!configuredSecret) return;

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
