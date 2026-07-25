import { Body, Controller, Get, Param, Patch } from '@nestjs/common';

import { Roles } from '../common/decorators/roles.decorator';
import { AdminAttentionService } from './admin-attention.service';
import { BookingTableLockService } from './booking-table-lock.service';

@Roles('owner', 'admin')
@Controller('admin-attention')
export class AdminAttentionController {
  constructor(
    private readonly attention: AdminAttentionService,
    private readonly tableLock: BookingTableLockService,
  ) {}

  @Get()
  dashboard() {
    return this.attention.dashboard();
  }

  @Patch('table-change/:requestId/approve')
  approveTableChange(
    @Param('requestId') requestId: string,
    @Body('tableId') tableId: string,
  ) {
    return this.tableLock.withTableChangeRequestLock(requestId, tableId, () =>
      this.attention.approveTableChange(requestId, tableId),
    );
  }

  @Patch('table-change/:requestId/reject')
  rejectTableChange(
    @Param('requestId') requestId: string,
    @Body('adminComment') adminComment?: string,
  ) {
    return this.attention.rejectTableChange(requestId, adminComment);
  }
}
