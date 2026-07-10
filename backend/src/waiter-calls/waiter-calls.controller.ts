import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';

import { Public } from '../common/decorators/public.decorator';
import { WaiterCallsService } from './waiter-calls.service';

@Public()
@Controller('waiter-calls')
export class WaiterCallsController {
  constructor(private readonly service: WaiterCallsService) {}

  @Post()
  createFromGuest(@Body() dto: { bookingId: string }) {
    return this.service.createFromGuest(dto);
  }

  @Get()
  list(@Query('waiterId') waiterId?: string) {
    return this.service.list(waiterId);
  }

  @Get('guest-status/:bookingId')
  guestStatus(@Param('bookingId') bookingId: string) {
    return this.service.guestStatus(bookingId);
  }

  @Get('assignments')
  assignments(@Query('waiterId') waiterId: string) {
    return this.service.myAssignments(waiterId);
  }

  @Post('assign')
  assign(@Body() dto: {
    bookingId: string;
    tableId?: string | null;
    tableNumber?: string | null;
    waiterId: string;
    waiterName: string;
  }) {
    return this.service.assign(dto);
  }

  @Patch(':id/accept')
  accept(@Param('id') id: string, @Body() dto: { waiterId: string; waiterName: string }) {
    return this.service.accept(id, dto);
  }

  @Patch(':id/close')
  close(@Param('id') id: string) {
    return this.service.close(id);
  }
}
