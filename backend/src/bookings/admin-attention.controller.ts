import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Query,
  Req,
} from '@nestjs/common';

import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { AdminAttentionService } from './admin-attention.service';
import { BookingTableLockService } from './booking-table-lock.service';
import { GuestChangeTableDto } from './dto/guest-change-table.dto';

@Roles('owner', 'admin')
@Controller('bookings/admin-attention')
export class AdminAttentionController {
  constructor(
    private readonly attention: AdminAttentionService,
    private readonly tableLock: BookingTableLockService,
  ) {}

  @Get()
  feed(@Query('limit') limit?: string) {
    return this.attention.feed(Number(limit));
  }

  @Patch('reschedules/:requestId/approve')
  approveReschedule(@Param('requestId') requestId: string, @Req() request: any) {
    return this.attention.approveReschedule(requestId, request.user);
  }

  @Patch('reschedules/:requestId/reject')
  rejectReschedule(
    @Param('requestId') requestId: string,
    @Body('adminComment') adminComment: string,
    @Req() request: any,
  ) {
    return this.attention.rejectReschedule(
      requestId,
      adminComment,
      request.user,
    );
  }

  @Patch('table-changes/:requestId/approve')
  approveTableChange(
    @Param('requestId') requestId: string,
    @Body('tableId') tableId: string,
    @Req() request: any,
  ) {
    return this.tableLock.withAdminTableChangeLock(
      requestId,
      tableId,
      () => this.attention.approveTableChange(requestId, tableId, request.user),
    );
  }

  @Patch('table-changes/:requestId/reject')
  rejectTableChange(
    @Param('requestId') requestId: string,
    @Body('adminComment') adminComment: string,
    @Req() request: any,
  ) {
    return this.attention.rejectTableChange(
      requestId,
      adminComment,
      request.user,
    );
  }
}

@Controller('bookings')
export class GuestAdminAttentionController {
  constructor(private readonly attention: AdminAttentionService) {}

  @Public()
  @Patch(':id/guest/request-table-change')
  requestTableChange(
    @Param('id') id: string,
    @Headers('x-guest-booking-token') token: string,
    @Body() dto: GuestChangeTableDto,
  ) {
    return this.attention.requestTableChange(id, token, dto);
  }
}
