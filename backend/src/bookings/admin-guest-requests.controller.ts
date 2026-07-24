import { Body, Controller, Get, Param, Patch } from '@nestjs/common';

import { Roles } from '../common/decorators/roles.decorator';
import { AdminGuestRequestsService } from './admin-guest-requests.service';

@Roles('owner', 'admin')
@Controller('bookings/admin-guest-requests')
export class AdminGuestRequestsController {
  constructor(private readonly requests: AdminGuestRequestsService) {}

  @Get()
  list() {
    return this.requests.list();
  }

  @Patch('reviews/:id/ack')
  acknowledgeReview(@Param('id') id: string) {
    return this.requests.acknowledgeReview(id);
  }

  @Patch('reschedules/:id/approve')
  approveReschedule(@Param('id') id: string) {
    return this.requests.approveReschedule(id);
  }

  @Patch('reschedules/:id/reject')
  rejectReschedule(
    @Param('id') id: string,
    @Body('adminComment') adminComment?: string,
  ) {
    return this.requests.rejectReschedule(id, adminComment);
  }

  @Patch('table-changes/:id/approve')
  approveTableChange(
    @Param('id') id: string,
    @Body('tableId') tableId: string,
  ) {
    return this.requests.approveTableChange(id, tableId);
  }

  @Patch('table-changes/:id/reject')
  rejectTableChange(
    @Param('id') id: string,
    @Body('adminComment') adminComment?: string,
  ) {
    return this.requests.rejectTableChange(id, adminComment);
  }
}
