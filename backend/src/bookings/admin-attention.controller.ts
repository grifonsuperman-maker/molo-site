import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';

import { Roles } from '../common/decorators/roles.decorator';
import { AdminAttentionService } from './admin-attention.service';

@Roles('owner', 'admin')
@Controller('admin-attention')
export class AdminAttentionController {
  constructor(private readonly attention: AdminAttentionService) {}

  @Get()
  list(@Query('limit') limit?: string) {
    return this.attention.list(Number(limit));
  }

  @Get('table-change/:requestId/options')
  tableOptions(@Param('requestId') requestId: string) {
    return this.attention.tableOptions(requestId);
  }

  @Patch('table-change/:requestId/approve')
  approveTableChange(
    @Param('requestId') requestId: string,
    @Body('tableId') tableId: string,
  ) {
    return this.attention.approveTableChange(requestId, tableId);
  }

  @Patch('table-change/:requestId/reject')
  rejectTableChange(
    @Param('requestId') requestId: string,
    @Body('adminComment') adminComment?: string,
  ) {
    return this.attention.rejectTableChange(requestId, adminComment);
  }

  @Patch('reschedule/:requestId/approve')
  approveReschedule(@Param('requestId') requestId: string) {
    return this.attention.approveReschedule(requestId);
  }

  @Patch('reschedule/:requestId/reject')
  rejectReschedule(
    @Param('requestId') requestId: string,
    @Body('adminComment') adminComment?: string,
  ) {
    return this.attention.rejectReschedule(requestId, adminComment);
  }

  @Patch('admin-call/:callId/accept')
  acceptAdminCall(@Param('callId') callId: string) {
    return this.attention.acceptAdminCall(callId);
  }

  @Patch('admin-call/:callId/complete')
  completeAdminCall(@Param('callId') callId: string) {
    return this.attention.completeAdminCall(callId);
  }
}
