import { Body, Controller, Get, Post } from '@nestjs/common';

import { Public } from '../common/decorators/public.decorator';
import { RegisterGuestPushSubscriptionDto } from './dto/register-guest-push-subscription.dto';
import { GuestPushService } from './guest-push.service';

@Controller('push/guest')
export class GuestPushController {
  constructor(private readonly guestPush: GuestPushService) {}

  @Public()
  @Get('config')
  config() {
    return this.guestPush.config();
  }

  @Public()
  @Post('subscriptions')
  register(@Body() dto: RegisterGuestPushSubscriptionDto) {
    return this.guestPush.register(dto);
  }
}
