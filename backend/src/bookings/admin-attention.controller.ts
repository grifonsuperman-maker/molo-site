import { Body, Controller, Get, Param, Patch } from '@nestjs/common';

import { Roles } from '../common/decorators/roles.decorator';
import { AdminAttentionService } from './admin-attention.service';

@Roles('owner', 'admin')
@Controller('admin-attention')
export class AdminAttentionController {
  constructor(private readonly attention: AdminAttentionService) {}

  @Get()
  dashboard() {
    return this.attention.dashboard();
  }

  @Patch('table-change/:requestId/approve')
  approveTableChange(
    @Param('requestId') requestId: string,
    @Body('tableId') tableId: string,
  ) {
    // approveTableChange already owns a transaction and row locks. Wrapping it in
    // a session advisory lock held by another QueryRunner requires a second pool
    // connection and can fail on small/transaction-pooled production databases.
    return this.attention.approveTableChange(requestId, tableId);
  }

  @Patch('table-change/:requestId/reject')
  rejectTableChange(
    @Param('requestId') requestId: string,
    @Body('adminComment') adminComment?: string,
  ) {
    return this.attention.rejectTableChange(requestId, adminComment);
  }
}
