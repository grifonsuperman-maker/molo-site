import { Body, Controller, Get, Headers, Param, Patch, Query } from '@nestjs/common';

import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { AdminGuestActionsService } from './admin-guest-actions.service';

@Controller('bookings')
export class AdminGuestActionsController {
  constructor(private readonly actions: AdminGuestActionsService) {}

  @Public()
  @Patch(':id/guest/table-change-request')
  requestTableChange(
    @Param('id') id: string,
    @Headers('x-guest-booking-token') token: string,
    @Body('tableNumber') tableNumber?: string,
  ) {
    return this.actions.requestTableChange(id, token, tableNumber);
  }

  @Roles('owner', 'admin')
  @Get('admin-actions/table-changes/pending')
  pendingTableChanges() {
    return this.actions.pendingTableChanges();
  }

  @Roles('owner', 'admin')
  @Patch('admin-actions/table-changes/:requestId/approve')
  approveTableChange(
    @Param('requestId') requestId: string,
    @Body('tableId') tableId: string,
  ) {
    return this.actions.approveTableChange(requestId, tableId);
  }

  @Roles('owner', 'admin')
  @Patch('admin-actions/table-changes/:requestId/reject')
  rejectTableChange(
    @Param('requestId') requestId: string,
    @Body('adminComment') adminComment?: string,
  ) {
    return this.actions.rejectTableChange(requestId, adminComment);
  }

  @Roles('owner', 'admin')
  @Get('admin-actions/reviews')
  reviews(@Query('limit') limit?: string) {
    return this.actions.reviews(Number(limit));
  }
}
