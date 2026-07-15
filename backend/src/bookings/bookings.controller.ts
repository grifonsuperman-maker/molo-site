import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { CheckAvailabilityDto } from './dto/check-availability.dto';
import { RequestRescheduleDto } from './dto/request-reschedule.dto';
import { RejectRescheduleDto } from './dto/reject-reschedule.dto';
import { Public } from '../common/decorators/public.decorator';

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

  @Public()
  @Get('table-statuses')
  tableStatuses(@Query() dto: any) {
    return this.service.getTableStatuses(dto);
  }

  @Public()
  @Get('pending-reminders')
  pendingRemindersList() {
    return this.service.getPendingReminders();
  }

  // Тимчасово відкрито для тестових панелей.
  // Після впровадження авторизації повернемо перевірку ролей.
  @Public()
  @Get('today')
  today() {
    return this.service.getToday();
  }

  @Public()
  @Get('by-date')
  byDate(@Query('date') date: string) {
    return this.service.getByDate(date);
  }

  @Public()
  @Get('archive')
  archive(
    @Query('date') date?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.getArchive(date, Number(limit));
  }

  @Public()
  @Get('stats')
  stats() {
    return this.service.getStats();
  }

  @Public()
  @Get('reschedule/pending')
  pendingReschedules() {
    return this.service.getPendingReschedules();
  }

  @Public()
  @Get(':id/status')
  publicStatus(@Param('id') id: string) {
    return this.service.getPublicStatus(id);
  }

  @Public()
  @Patch(':id/approve')
  approve(@Param('id') id: string) {
    return this.service.approve(id);
  }

  @Public()
  @Patch(':id/reject')
  reject(@Param('id') id: string) {
    return this.service.reject(id);
  }

  @Public()
  @Patch(':id/cancel')
  cancel(@Param('id') id: string) {
    return this.service.cancel(id);
  }

  @Public()
  @Patch(':id/no-show')
  noShow(@Param('id') id: string) {
    return this.service.noShow(id);
  }

  @Public()
  @Patch(':id/check-in')
  checkIn(@Param('id') id: string) {
    return this.service.checkIn(id);
  }

  @Public()
  @Patch(':id/complete')
  complete(@Param('id') id: string) {
    return this.service.complete(id);
  }

  @Public()
  @Post(':id/reschedule')
  requestReschedule(
    @Param('id') id: string,
    @Body() dto: RequestRescheduleDto,
  ) {
    return this.service.requestReschedule(id, dto);
  }

  @Public()
  @Patch('reschedule/:requestId/approve')
  approveReschedule(@Param('requestId') requestId: string) {
    return this.service.approveReschedule(requestId);
  }

  @Public()
  @Patch('reschedule/:requestId/reject')
  rejectReschedule(
    @Param('requestId') requestId: string,
    @Body() dto: RejectRescheduleDto,
  ) {
    return this.service.rejectReschedule(requestId, dto);
  }
}
