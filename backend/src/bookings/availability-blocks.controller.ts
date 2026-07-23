import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';

import { Roles } from '../common/decorators/roles.decorator';
import { AvailabilityBlocksService } from './availability-blocks.service';
import { AvailabilityPermissionsService } from './availability-permissions.service';
import { BookingTableLockService } from './booking-table-lock.service';
import { CreateAvailabilityBlockDto } from './dto/create-availability-block.dto';
import { TransferFutureBookingDto } from './dto/transfer-future-booking.dto';

@Roles('owner', 'admin')
@Controller('availability-blocks')
export class AvailabilityBlocksController {
  constructor(
    private readonly service: AvailabilityBlocksService,
    private readonly permissions: AvailabilityPermissionsService,
    private readonly tableLock: BookingTableLockService,
  ) {}

  @Get()
  list(@Query('date') date: string) {
    return this.service.list(date);
  }

  @Post()
  async create(@Body() dto: CreateAvailabilityBlockDto, @Req() request: any) {
    await this.permissions.assertCanManage(request.user);
    return this.tableLock.withAvailabilityBlockLock(dto, () =>
      this.service.create(dto, request.user),
    );
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Req() request: any) {
    await this.permissions.assertCanManage(request.user);
    return this.service.remove(id, request.user);
  }

  @Patch('bookings/:bookingId/transfer')
  async transferBooking(
    @Param('bookingId') bookingId: string,
    @Body() dto: TransferFutureBookingDto,
    @Req() request: any,
  ) {
    await this.permissions.assertCanManage(request.user);
    return this.tableLock.withTransferLock(bookingId, dto.tableId, () =>
      this.service.transferBooking(bookingId, dto, request.user),
    );
  }
}
