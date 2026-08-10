import { Body, Controller, Headers, Post } from '@nestjs/common';
import { TelegramWebhookService } from './telegram-webhook.service';
import { Public } from '../common/decorators/public.decorator';
import { assertTelegramWebhookSecret } from './telegram-webhook-secret';

@Public()
@Controller('telegram')
export class TelegramWebhookController {
  constructor(private readonly service: TelegramWebhookService) {}

  @Post('webhook')
  handle(
    @Body() update: any,
    @Headers('x-telegram-bot-api-secret-token') secretToken?: string,
  ) {
    assertTelegramWebhookSecret(secretToken);
    return this.service.handleUpdate(update);
  }
}
