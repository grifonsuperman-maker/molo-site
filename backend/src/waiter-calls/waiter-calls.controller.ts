import { Body, Controller, Get, Headers, Param, Patch, Post, Query } from '@nestjs/common';

import { Public } from '../common/decorators/public.decorator';
import { GuestBookingsService } from '../bookings/guest-bookings.service';
import { WaiterCallsService } from './waiter-calls.service';

@Public()
@Controller('waiter-calls')
export class WaiterCallsController {
  constructor(private readonly service: WaiterCallsService, private readonly guestBookings: GuestBookingsService) {}

  @Post()
  async createFromGuest(@Body() dto: { bookingId: string }, @Headers('x-guest-booking-token') token: string) {
    await this.guestBookings.get(dto.bookingId, token);
    return this.service.createFromGuest(dto);
  }

  @Get()
  list(@Query('waiterId') waiterId?: string) {
    return this.service.list(waiterId);
  }

  @Get('guest-status/:bookingId')
  async guestStatus(@Param('bookingId') bookingId: string, @Headers('x-guest-booking-token') token: string) {
    await this.guestBookings.get(bookingId, token);
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
