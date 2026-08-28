import {
  Body,
  Controller,
  Get,
  HttpException,
  InternalServerErrorException,
  Logger,
  Param,
  Patch,
} from '@nestjs/common';
import { randomUUID } from 'crypto';

import { Roles } from '../common/decorators/roles.decorator';
import { AdminAttentionService } from './admin-attention.service';
import { BookingRescheduleApprovalService } from './booking-reschedule-approval.service';
import { BookingsService } from './bookings.service';

@Roles('owner', 'admin')
@Controller('admin-attention')
export class AdminAttentionController {
  private readonly logger = new Logger(AdminAttentionController.name);

  constructor(
    private readonly attention: AdminAttentionService,
    private readonly bookings: BookingsService,
    private readonly rescheduleApproval: BookingRescheduleApprovalService,
  ) {}

  @Get()
  dashboard() {
    return this.attention.dashboard();
  }

  @Get('reschedules')
  @Roles('admin')
  reschedules() {
    return this.bookings.getPendingReschedules();
  }

  @Patch('reschedule/:requestId/approve')
  @Roles('admin')
  approveReschedule(@Param('requestId') requestId: string) {
    return this.rescheduleApproval.approve(requestId);
  }

  @Patch('reschedule/:requestId/reject')
  @Roles('admin')
  rejectReschedule(
    @Param('requestId') requestId: string,
    @Body('adminComment') adminComment?: string,
  ) {
    return this.bookings.rejectReschedule(requestId, { adminComment });
  }

  @Patch('table-change/:requestId/approve')
  async approveTableChange(
    @Param('requestId') requestId: string,
    @Body('tableId') tableId: string,
  ) {
    try {
      return await this.attention.approveTableChange(requestId, tableId);
    } catch (error) {
      if (error instanceof HttpException) throw error;

      const diagnosticId = `TRANSFER-${randomUUID().slice(0, 8).toUpperCase()}`;
      const failure = this.describeFailure(error);

      this.logger.error(
        JSON.stringify({
          event: 'admin_table_change_approval_failed',
          diagnosticId,
          stage: 'approve_transaction',
          requestId,
          tableId,
          ...failure,
        }),
        failure.stack,
      );

      throw new InternalServerErrorException(
        `Не вдалося підтвердити пересадку. Код діагностики: ${diagnosticId}`,
      );
    }
  }

  @Patch('table-change/:requestId/reject')
  rejectTableChange(
    @Param('requestId') requestId: string,
    @Body('adminComment') adminComment?: string,
  ) {
    return this.attention.rejectTableChange(requestId, adminComment);
  }

  private describeFailure(error: unknown) {
    const value = error as any;
    const driver = value?.driverError || value?.cause || null;

    return {
      errorName: value?.name || 'UnknownError',
      errorMessage: value?.message || String(error),
      postgresCode: value?.code || driver?.code || null,
      postgresDetail: value?.detail || driver?.detail || null,
      postgresConstraint: value?.constraint || driver?.constraint || null,
      postgresTable: value?.table || driver?.table || null,
      postgresColumn: value?.column || driver?.column || null,
      query: value?.query || null,
      parameters: Array.isArray(value?.parameters) ? value.parameters : null,
      stack: value?.stack || null,
    };
  }
}
