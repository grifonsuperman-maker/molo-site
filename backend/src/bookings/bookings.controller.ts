import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { CheckAvailabilityDto } from './dto/check-availability.dto';
import { RequestRescheduleDto } from './dto/request-reschedule.dto';
import { RejectRescheduleDto } from './dto/reject-reschedule.dto';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('bookings')
export class BookingsController {
  constructor(private readonly service: BookingsService) {}

  @Public()
  @Post()
  create(@Body() dto: CreateBookingDto) {
    return this.service.create(dto);
  }

  @Public()
  @Get('availability')
  availability(@Query() dto: CheckAvailabilityDto) {
    return this.service.checkAvailability(dto);
  }

  @Roles('owner', 'admin', 'waiter')
  @Get('today')
  today() {
    return this.service.getToday();
  }

  @Roles('owner', 'admin')
  @Patch(':id/approve')
  approve(@Param('id') id: string) {
    return this.service.approve(id);
  }

  @Roles('owner', 'admin')
  @Patch(':id/reject')
  reject(@Param('id') id: string) {
    return this.service.reject(id);
  }

  @Roles('owner', 'admin')
  @Patch(':id/cancel')
  cancel(@Param('id') id: string) {
    return this.service.cancel(id);
  }

  @Roles('owner', 'admin', 'waiter')
  @Patch(':id/check-in')
  checkIn(@Param('id') id: string) {
    return this.service.checkIn(id);
  }

  @Roles('owner', 'admin', 'waiter')
  @Patch(':id/complete')
  complete(@Param('id') id: string) {
    return this.service.complete(id);
  }

  @Public()
  @Post(':id/reschedule')
  requestReschedule(@Param('id') id: string, @Body() dto: RequestRescheduleDto) {
    return this.service.requestReschedule(id, dto);
  }

  @Roles('owner', 'admin')
  @Get('reschedule/pending')
  pendingReschedules() {
    return this.service.getPendingReschedules();
  }

  @Roles('owner', 'admin')
  @Patch('reschedule/:requestId/approve')
  approveReschedule(@Param('requestId') requestId: string) {
    return this.service.approveReschedule(requestId);
  }

  @Roles('owner', 'admin')
  @Patch('reschedule/:requestId/reject')
  rejectReschedule(@Param('requestId') requestId: string, @Body() dto: RejectRescheduleDto) {
    return this.service.rejectReschedule(requestId, dto);
  }
}
