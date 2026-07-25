import { Body, Controller, Get, Param, Patch, Req } from '@nestjs/common';

import { Roles } from '../common/decorators/roles.decorator';
import { AdminAttentionService } from './admin-attention.service';
import { BookingRescheduleApprovalService } from './booking-reschedule-approval.service';
import { BookingsService } from './bookings.service';

@Roles('owner', 'admin')
@Controller('bookings/admin-attention')
export class AdminAttentionController {
  constructor(
    private readonly attention: AdminAttentionService,
    private readonly rescheduleApproval: BookingRescheduleApprovalService,
    private readonly bookings: BookingsService,
  ) {}

  @Get()
  list() {
    return this.attention.list();
  }

  @Patch(':requestId/acknowledge')
  acknowledge(@Param('requestId') requestId: string, @Req() request: any) {
    return this.attention.acknowledgeHistory(requestId, request.user);
  }

  @Patch('table-change/:requestId/approve')
  approveTableChange(
    @Param('requestId') requestId: string,
    @Body('tableId') tableId: string,
    @Req() request: any,
  ) {
    return this.attention.approveTableChange(requestId, tableId, request.user);
  }

  @Patch('table-change/:requestId/reject')
  rejectTableChange(
    @Param('requestId') requestId: string,
    @Body('comment') comment: string,
    @Req() request: any,
  ) {
    return this.attention.rejectTableChange(requestId, comment, request.user);
  }

  @Patch('call/:requestId/accept')
  acceptCall(@Param('requestId') requestId: string, @Req() request: any) {
    return this.attention.acceptAdminCall(requestId, request.user);
  }

  @Patch('call/:requestId/complete')
  completeCall(@Param('requestId') requestId: string, @Req() request: any) {
    return this.attention.completeAdminCall(requestId, request.user);
  }

  @Patch('review/:reviewId/acknowledge')
  acknowledgeReview(@Param('reviewId') reviewId: string, @Req() request: any) {
    return this.attention.acknowledgeReview(reviewId, request.user);
  }

  @Patch('reschedule/:requestId/approve')
  async approveReschedule(@Param('requestId') requestId: string) {
    const result = await this.rescheduleApproval.approve(requestId);
    await this.attention.setRescheduleNotification(requestId, true);
    return result;
  }

  @Patch('reschedule/:requestId/reject')
  async rejectReschedule(
    @Param('requestId') requestId: string,
    @Body('comment') comment: string,
  ) {
    const result = await this.bookings.rejectReschedule(requestId, {
      adminComment: String(comment || '').trim() || undefined,
    });
    await this.attention.setRescheduleNotification(requestId, false, comment);
    return result;
  }
}
