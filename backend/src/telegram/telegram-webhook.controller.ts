import { Body, Controller, Post } from '@nestjs/common';
import { TelegramWebhookService } from './telegram-webhook.service';
import { Public } from '../common/decorators/public.decorator';

@Public()
@Controller('telegram')
export class TelegramWebhookController {
  constructor(private readonly service: TelegramWebhookService) {}

  @Post('webhook')
  handle(@Body() update: any) {
    return this.service.handleUpdate(update);
  }
}
