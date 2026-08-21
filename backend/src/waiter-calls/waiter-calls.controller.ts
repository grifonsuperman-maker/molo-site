import { Body, Controller, Get, Headers, Param, Patch, Post, Req } from '@nestjs/common';

import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { WaiterCallTelegramNotifierService } from './waiter-call-telegram-notifier.service';
import { WaiterCallsService } from './waiter-calls.service';

@Controller('waiter-calls')
export class WaiterCallsController {
  constructor(
    private readonly service: WaiterCallsService,
    private readonly telegramNotifier: WaiterCallTelegramNotifierService,
  ) {}

  @Post()
  @Public()
  async createFromGuest(
    @Body() dto: { bookingId: string },
    @Headers('x-guest-booking-token') guestToken?: string,
  ) {
    const timingStartedAtMs = Date.now();
    const result = await this.service.createFromGuest(dto, guestToken);

    if (result.message !== 'Виклик вже відправлено') {
      this.logTelegramTiming('call_saved', result.call.id, timingStartedAtMs);
      void this.notifyTelegramWaiters(result.call, timingStartedAtMs);
    }

    return result;
  }

  @Get()
  @Roles('waiter')
  list(@Req() request: any) {
    return this.service.list(request.user.staffId);
  }

  @Get('guest-status/:bookingId')
  @Public()
  guestStatus(
    @Param('bookingId') bookingId: string,
    @Headers('x-guest-booking-token') guestToken?: string,
  ) {
    return this.service.guestStatus(bookingId, guestToken);
  }

  @Get('assignments')
  @Roles('waiter')
  assignments(@Req() request: any) {
    return this.service.myAssignments(request.user.staffId);
  }

  @Post('assign')
  @Roles('waiter')
  assign(@Body() dto: {
    bookingId: string;
    tableId?: string | null;
    tableNumber?: string | null;
  }, @Req() request: any) {
    return this.service.assign({ ...dto, waiterId: request.user.staffId, waiterName: request.user.name });
  }

  @Patch(':id/accept')
  @Roles('waiter')
  accept(@Param('id') id: string, @Req() request: any) {
    return this.service.accept(id, { waiterId: request.user.staffId, waiterName: request.user.name });
  }

  @Patch(':id/close')
  @Roles('waiter')
  close(@Param('id') id: string, @Req() request: any) {
    return this.service.close(id, request.user.staffId);
  }

  private async notifyTelegramWaiters(
    call: Awaited<ReturnType<WaiterCallsService['createFromGuest']>>['call'],
    timingStartedAtMs: number,
  ) {
    try {
      this.logTelegramTiming('notify_start', call.id, timingStartedAtMs);
      const activeCalls = await this.service.list();
      this.logTelegramTiming(
        'active_calls_loaded',
        call.id,
        timingStartedAtMs,
        { activeCount: activeCalls.length },
      );
      await this.telegramNotifier.notifyCreated(
        call,
        activeCalls,
        timingStartedAtMs,
      );
    } catch (error: any) {
      console.error(
        'Telegram waiter call notification failed:',
        error?.message || error,
      );
    }
  }

  private logTelegramTiming(
    stage: string,
    callId: string,
    timingStartedAtMs: number,
    details: Record<string, unknown> = {},
  ) {
    console.info(
      '[waiter-call-timing]',
      JSON.stringify({
        stage,
        callId,
        elapsedMs: Date.now() - timingStartedAtMs,
        ...details,
      }),
    );
  }
}
