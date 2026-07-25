import { Body, Controller, Get, Param, Patch, Req } from '@nestjs/common';

import { Roles } from '../common/decorators/roles.decorator';
import { AdminAttentionService } from './admin-attention.service';
import { AdminTableChangeApprovalService } from './admin-table-change-approval.service';

@Roles('owner', 'admin')
@Controller('bookings/admin-attention')
export class AdminAttentionController {
  constructor(
    private readonly attention: AdminAttentionService,
    private readonly tableChangeApproval: AdminTableChangeApprovalService,
  ) {}

  @Get()
  async list() {
    const items = await this.attention.list();
    return items.filter(
      (item: { kind?: string }) =>
        item.kind !== 'admin_call' && item.kind !== 'reschedule',
    );
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
    return this.tableChangeApproval.approve(requestId, tableId, request.user);
  }

  @Patch('table-change/:requestId/reject')
  rejectTableChange(
    @Param('requestId') requestId: string,
    @Body('comment') comment: string,
    @Req() request: any,
  ) {
    return this.attention.rejectTableChange(requestId, comment, request.user);
  }

  @Patch('review/:reviewId/acknowledge')
  acknowledgeReview(@Param('reviewId') reviewId: string, @Req() request: any) {
    return this.attention.acknowledgeReview(reviewId, request.user);
  }
}
