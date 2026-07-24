import { Body, Controller, Get, Headers, Param, Patch, Post } from '@nestjs/common';

import { Public } from '../common/decorators/public.decorator';
import { GuestAttentionService } from './guest-attention.service';

@Public()
@Controller('guest-attention')
export class GuestAttentionController {
  constructor(private readonly attention: GuestAttentionService) {}

  @Patch(':bookingId/table-change')
  requestTableChange(
    @Param('bookingId') bookingId: string,
    @Headers('x-guest-booking-token') token: string,
    @Body() body: { tableNumber?: string | null },
  ) {
    return this.attention.requestTableChange(bookingId, token, body || {});
  }

  @Get(':bookingId/admin-call')
  adminCallStatus(@Param('bookingId') bookingId: string) {
    return this.attention.getAdminCallStatus(bookingId);
  }

  @Post(':bookingId/admin-call')
  createAdminCall(@Param('bookingId') bookingId: string) {
    return this.attention.createAdminCall(bookingId);
  }
}
