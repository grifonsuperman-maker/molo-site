import { Body, Controller, Headers, Param, Patch, Post } from '@nestjs/common';

import { Public } from '../common/decorators/public.decorator';
import { GuestRequestsService } from './guest-requests.service';

@Controller('bookings')
export class GuestRequestsController {
  constructor(private readonly requests: GuestRequestsService) {}

  @Public()
  @Patch(':id/guest/request-table-change')
  requestTableChange(
    @Param('id') id: string,
    @Headers('x-guest-booking-token') token: string,
    @Body() body: { tableId?: string; tableNumber?: string },
  ) {
    return this.requests.requestTableChange(id, token, body);
  }

  @Public()
  @Post(':id/guest/call-admin')
  callAdmin(
    @Param('id') id: string,
    @Headers('x-guest-booking-token') token: string,
  ) {
    return this.requests.callAdmin(id, token);
  }
}
