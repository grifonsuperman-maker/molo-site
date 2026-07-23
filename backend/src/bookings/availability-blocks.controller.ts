import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';

import { Roles } from '../common/decorators/roles.decorator';
import { AvailabilityBlocksService } from './availability-blocks.service';
import { BookingTableLockService } from './booking-table-lock.service';
import { CreateAvailabilityBlockDto } from './dto/create-availability-block.dto';
import { TransferFutureBookingDto } from './dto/transfer-future-booking.dto';

@Roles('owner', 'admin')
@Controller('availability-blocks')
export class AvailabilityBlocksController {
  constructor(
    private readonly service: AvailabilityBlocksService,
    private readonly tableLock: BookingTableLockService,
  ) {}

  @Get()
  list(@Query('date') date: string) {
    return this.service.list(date);
  }

  @Post()
  create(@Body() dto: CreateAvailabilityBlockDto, @Req() request: any) {
    return this.tableLock.withAvailabilityBlockLock(dto, () =>
      this.service.create(dto, request.user),
    );
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Req() request: any) {
    return this.service.remove(id, request.user);
  }

  @Patch('bookings/:bookingId/transfer')
  transferBooking(
    @Param('bookingId') bookingId: string,
    @Body() dto: TransferFutureBookingDto,
    @Req() request: any,
  ) {
    return this.tableLock.withTransferLock(bookingId, dto.tableId, () =>
      this.service.transferBooking(bookingId, dto, request.user),
    );
  }
}
