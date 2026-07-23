import { Body, Controller, Get, Headers, Param, Patch, Post, Query } from '@nestjs/common';

import { Public } from '../common/decorators/public.decorator';
import { NotificationsService } from '../notifications/notifications.service';
import { BookingCreationLockService } from './booking-creation-lock.service';
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
import { RequestRescheduleDto } from './dto/request-reschedule.dto';

@Controller('bookings')
export class BookingsController {
  constructor(
    private readonly service: BookingsService,
    private readonly guestService: GuestBookingsService,
    private readonly notifications: NotificationsService,
    private readonly creationLock: BookingCreationLockService,
  ) {}

  @Public()
  @Post()
  create(@Body() dto: CreateBookingDto) {
    return this.creationLock.run(
      {
        tableId: dto.tableId,
        tableNumber: dto.tableNumber,
        bookingDate: dto.bookingDate,
      },
      () => this.service.create(dto),
    );
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
  async guestCancel(
    @Param('id') id: string,
    @Headers('x-guest-booking-token') token: string,
    @Body() dto: GuestCancelBookingDto,
  ) {
    const result = await this.guestService.cancel(id, token, dto);
    await this.safeNotify(() => this.notifications.notifyGuestCancelledBooking(id));
    return result;
  }

  @Public()
  @Patch(':id/guest/lateness')
  async guestLateness(
    @Param('id') id: string,
    @Headers('x-guest-booking-token') token: string,
    @Body() dto: GuestLatenessDto,
  ) {
    const result = await this.guestService.reportLateness(id, token, dto);
    await this.safeNotify(() => this.notifications.notifyGuestReportedLateness(id));
    return result;
  }

  @Public()
  @Patch(':id/guest/change-table')
  async guestChangeTable(
    @Param('id') id: string,
    @Headers('x-guest-booking-token') token: string,
    @Body() dto: GuestChangeTableDto,
  ) {
    const previous = await this.guestService.get(id, token);
    const result = await this.guestService.changeTable(id, token, dto);
    await this.safeNotify(() =>
      this.notifications.notifyGuestChangedTable(
        id,
        previous.tableNumber,
        result.booking?.tableNumber,
      ),
    );
    return result;
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

  private async safeNotify(action: () => Promise<void>) {
    try {
      await action();
    } catch (error) {
      console.error('Guest action notification failed:', error);
    }
  }
}
