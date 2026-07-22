import { Body, Controller, Get, Headers, Param, Patch, Post, Query, Req } from '@nestjs/common';

import { Public } from '../common/decorators/public.decorator';
import { BookingTableLockService } from './booking-table-lock.service';
import { BookingsService } from './bookings.service';
import { GuestBookingsService } from './guest-bookings.service';
import { CheckAvailabilityDto } from './dto/check-availability.dto';
import { CreateBookingDto } from './dto/create-booking.dto';
import { GuestBookingListDto } from './dto/guest-booking-list.dto';
import { GuestCancelBookingDto } from './dto/guest-cancel-booking.dto';
import { GuestChangeTableDto } from './dto/guest-change-table.dto';
import { GuestLatenessDto } from './dto/guest-lateness.dto';
import { GuestReviewDto } from './dto/guest-review.dto';
import { RejectRescheduleDto } from './dto/reject-reschedule.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { RequestRescheduleDto } from './dto/request-reschedule.dto';

@Controller('bookings')
export class BookingsController {
  constructor(
    private readonly service: BookingsService,
    private readonly guestService: GuestBookingsService,
    private readonly tableLock: BookingTableLockService,
  ) {}

  @Public()
  @Post()
  create(@Body() dto: CreateBookingDto) {
    return this.tableLock.withCreateLock(dto, () => this.service.create(dto));
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
  @Post('guest/list')
  guestList(@Body() dto: GuestBookingListDto) {
    return this.guestService.list(dto);
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
  @Roles('waiter', 'admin', 'owner')
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
  archive(@Query('date') date?: string, @Query('limit') limit?: string) {
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
  @Get(':id/guest')
  guestBooking(
    @Param('id') id: string,
    @Headers('x-guest-booking-token') token: string,
  ) {
    return this.guestService.get(id, token);
  }

  @Public()
  @Patch(':id/guest/cancel')
  guestCancel(
    @Param('id') id: string,
    @Headers('x-guest-booking-token') token: string,
    @Body() dto: GuestCancelBookingDto,
  ) {
    return this.guestService.cancel(id, token, dto);
  }

  @Public()
  @Patch(':id/guest/lateness')
  guestLateness(
    @Param('id') id: string,
    @Headers('x-guest-booking-token') token: string,
    @Body() dto: GuestLatenessDto,
  ) {
    return this.guestService.reportLateness(id, token, dto);
  }

  @Public()
  @Patch(':id/guest/change-table')
  guestChangeTable(
    @Param('id') id: string,
    @Headers('x-guest-booking-token') token: string,
    @Body() dto: GuestChangeTableDto,
  ) {
    return this.guestService.changeTable(id, token, dto);
  }

  @Public()
  @Patch(':id/guest/notification/ack')
  guestAcknowledgeNotification(
    @Param('id') id: string,
    @Headers('x-guest-booking-token') token: string,
  ) {
    return this.guestService.acknowledgeNotification(id, token);
  }

  @Public()
  @Post(':id/guest/review')
  guestReview(
    @Param('id') id: string,
    @Headers('x-guest-booking-token') token: string,
    @Body() dto: GuestReviewDto,
  ) {
    return this.guestService.submitReview(id, token, dto);
  }

  @Public()
  @Patch(':id/guest/review/external-opened')
  guestExternalReviewOpened(
    @Param('id') id: string,
    @Headers('x-guest-booking-token') token: string,
  ) {
    return this.guestService.markExternalReviewOpened(id, token);
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

  @Patch(':id/check-in')
  @Roles('waiter', 'admin', 'owner')
  checkIn(@Param('id') id: string) {
    return this.service.checkIn(id);
  }

  @Patch(':id/complete')
  @Roles('waiter', 'admin', 'owner')
  complete(@Param('id') id: string) {
    return this.service.complete(id);
  }

  @Patch(':id/waiter-transfer')
  @Roles('waiter', 'admin', 'owner')
  waiterTransfer(@Param('id') id: string, @Body('tableId') tableId: string, @Req() request: any) {
    return this.tableLock.withTransferLock(id, tableId, () =>
      this.service.waiterTransfer(id, tableId, request.user),
    );
  }

  @Public()
  @Post(':id/reschedule')
  requestReschedule(@Param('id') id: string, @Body() dto: RequestRescheduleDto) {
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
