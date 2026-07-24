import { Body, Controller, Param, Patch } from '@nestjs/common';

import { Roles } from '../common/decorators/roles.decorator';
import { AdminRescheduleActionsService } from './admin-reschedule-actions.service';

@Roles('owner', 'admin')
@Controller('bookings/admin-actions/reschedules')
export class AdminRescheduleActionsController {
  constructor(private readonly actions: AdminRescheduleActionsService) {}

  @Patch(':requestId/approve')
  approve(@Param('requestId') requestId: string) {
    return this.actions.approve(requestId);
  }

  @Patch(':requestId/reject')
  reject(
    @Param('requestId') requestId: string,
    @Body('adminComment') adminComment?: string,
  ) {
    return this.actions.reject(requestId, adminComment);
  }
}
