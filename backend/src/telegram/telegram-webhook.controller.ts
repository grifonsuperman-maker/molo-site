import { Body, Controller, Headers, Post } from '@nestjs/common';
import { TelegramService } from '../notifications/telegram.service';
import { Public } from '../common/decorators/public.decorator';
import { TelegramWebhookService } from './telegram-webhook.service';
import { assertTelegramWebhookSecret } from './telegram-webhook-secret';

@Public()
@Controller('telegram')
export class TelegramWebhookController {
  constructor(
    private readonly service: TelegramWebhookService,
    private readonly telegram: TelegramService,
  ) {}

  @Post('webhook')
  async handle(
    @Body() update: any,
    @Headers('x-telegram-bot-api-secret-token') secretToken?: string,
  ) {
    assertTelegramWebhookSecret(secretToken);
    const result = await this.service.handleUpdate(update);

    const callback = update?.callback_query;
    const data = String(callback?.data || '');
    const chatId = callback?.message?.chat?.id;
    const messageId = callback?.message?.message_id;
    const isWaiterNavigation =
      data === 'menu:waiter' || data.startsWith('waiter:');

    if (
      result?.ok === true &&
      isWaiterNavigation &&
      chatId &&
      messageId != null
    ) {
      await this.telegram.deleteMessage(chatId, messageId).catch(() => undefined);
    }

    return result;
  }
}
