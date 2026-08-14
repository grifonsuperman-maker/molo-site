import { Body, Controller, Get, Headers, Param, Patch, Post, Req } from '@nestjs/common';

import { Public } from '../common/decorators/public.decorator';
import { WaiterCallsService } from './waiter-calls.service';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('waiter-calls')
export class WaiterCallsController {
  constructor(private readonly service: WaiterCallsService) {}

  @Post()
  @Public()
  createFromGuest(
    @Body() dto: { bookingId: string },
    @Headers('x-guest-booking-token') guestToken?: string,
  ) {
    return this.service.createFromGuest(dto, guestToken);
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
}
