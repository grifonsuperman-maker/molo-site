import { Body, Controller, Get, Headers, Param, Patch, Post, Query, Req } from '@nestjs/common';

import type { AuthUser } from '../auth/types/auth-user.type';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { NotificationsService } from '../notifications/notifications.service';
import { AdminAttentionService } from './admin-attention.service';
import { AvailabilityBlocksService } from './availability-blocks.service';
import { BookingTableLockService } from './booking-table-lock.service';
import { BookingsService } from './bookings.service';
import { CheckAvailabilityDto } from './dto/check-availability.dto';
import { CreateBookingDto } from './dto/create-booking.dto';
import { GuestBookingListDto } from './dto/guest-booking-list.dto';
import { GuestCancelBookingDto } from './dto/guest-cancel-booking.dto';
import { GuestChangeTableDto } from './dto/guest-change-table.dto';
import { GuestLatenessDto } from './dto/guest-lateness.dto';
import { GuestReviewDto } from './dto/guest-review.dto';
import { RequestRescheduleDto } from './dto/request-reschedule.dto';
import { GuestBookingsService } from './guest-bookings.service';
import { GuestTableNumberValidationService } from './guest-table-number-validation.service';
import { GuestTelegramLinkService } from './guest-telegram-link.service';
import { GuestTimeChangeService } from './guest-time-change.service';

@Controller('bookings')
export class BookingsController {
  constructor(
    private readonly service: BookingsService,
    private readonly guestService: GuestBookingsService,
    private readonly guestTelegramLink: GuestTelegramLinkService,
    private readonly tableLock: BookingTableLockService,
    private readonly availabilityBlocks: AvailabilityBlocksService,
    private readonly adminAttention: AdminAttentionService,
    private readonly notifications: NotificationsService,
    private readonly guestTimeChange: GuestTimeChangeService,
    private readonly guestTableNumbers: GuestTableNumberValidationService,
  ) {}

  private withGuestArrivalTimeCapabilities<T extends { status?: string; checkedInAt?: unknown }>(booking: T) {
    return {
      ...booking,
      canGuestChangeTime: booking.status === 'approved' && !booking.checkedInAt,
      canReportLateness: false,
    };
  }

  @Public()
  @Post()
  async create(@Body() dto: CreateBookingDto) {
    const existingTableNumber = await this.guestTableNumbers.resolveExisting(dto.tableNumber);
    const bookingDto = existingTableNumber
      ? { ...dto, tableNumber: existingTableNumber }
      : dto;

    return this.tableLock.withCreateLock(bookingDto, async () => {
      await this.availabilityBlocks.assertBookable(bookingDto);
      return this.service.create(bookingDto);
    });
  }

  @Public()
  @Get('availability')
  async availability(@Query() dto: CheckAvailabilityDto) {
    const payload = await this.service.checkAvailability(dto);
    return this.availabilityBlocks.applyAvailability(dto, payload);
  }

  @Public()
  @Get('table-statuses')
  async tableStatuses(@Query() dto: any) {
    const payload = await this.service.getTableStatuses(dto);
    return this.availabilityBlocks.applyTableStatuses(dto, payload);
  }

  @Public()
  @Post('guest/list')
  async guestList(@Body() dto: GuestBookingListDto) {
    const bookings = await this.guestService.list(dto);
    return bookings.map((booking) => this.withGuestArrivalTimeCapabilities(booking));
  }

  @Patch(':id/guest/telegram')
  @Roles('guest')
  guestLinkTelegram(
    @Param('id') id: string,
    @Headers('x-guest-booking-token') token: string,
    @Req() request: { user: AuthUser },
  ) {
    return this.guestTelegramLink.link(id, token, request.user);
  }

  @Get('pending-reminders')
  @Roles('admin', 'owner')
  pendingRemindersList() {
    return this.service.getPendingReminders();
  }

  @Get('today')
  @Roles('waiter', 'admin', 'owner')
  today() {
    return this.service.getToday();
  }

  @Get('by-date')
  @Roles('admin', 'owner')
  byDate(@Query('date') date: string) {
    return this.service.getByDate(date);
  }

  @Get('archive')
  @Roles('admin', 'owner')
  archive(@Query('date') date?: string, @Query('limit') limit?: string) {
    return this.service.getArchive(date, Number(limit));
  }

  @Get('stats')
  @Roles('admin', 'owner')
  stats() {
    return this.service.getStats();
  }

  @Public()
  @Get(':id/guest')
  async guestBooking(
    @Param('id') id: string,
    @Headers('x-guest-booking-token') token: string,
  ) {
    const booking = await this.guestService.get(id, token);
    return this.withGuestArrivalTimeCapabilities(booking);
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
  async guestLateness(
    @Param('id') id: string,
    @Headers('x-guest-booking-token') token: string,
    @Body() dto: GuestLatenessDto,
  ) {
    const { rescheduleRequest, ...result } = await this.guestService.reportLateness(id, token, dto);

    try {
      await this.notifications.notifyRescheduleRequest(rescheduleRequest);
    } catch (error) {
      console.error('Telegram guest lateness reschedule notification failed', error);
    }

    return {
      ...result,
      message: 'Запит на перенесення надіслано адміністратору',
    };
  }

  @Public()
  @Patch(':id/guest/change-time')
  async guestChangeTime(
    @Param('id') id: string,
    @Headers('x-guest-booking-token') token: string,
    @Body() dto: RequestRescheduleDto,
  ) {
    const { rescheduleRequest, booking, ...result } = await this.guestTimeChange.request(id, token, dto);

    try {
      await this.notifications.notifyRescheduleRequest(rescheduleRequest);
    } catch (error) {
      console.error('Telegram guest time-change reschedule notification failed', error);
    }

    return {
      ...result,
      booking: this.withGuestArrivalTimeCapabilities(booking),
      message: 'Запит на зміну часу надіслано адміністратору',
    };
  }

  @Public()
  @Patch(':id/guest/change-table')
  async guestChangeTable(
    @Param('id') id: string,
    @Headers('x-guest-booking-token') token: string,
    @Body() dto: GuestChangeTableDto,
  ) {
    await this.guestService.get(id, token);
    const existingTableNumber = await this.guestTableNumbers.resolveExisting(dto.tableNumber);
    const requestedTable = existingTableNumber
      ? { ...dto, tableNumber: existingTableNumber }
      : dto;

    return this.adminAttention.requestTableChange(id, token, requestedTable);
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

  @Patch(':id/approve')
  @Roles('admin', 'owner')
  approve(@Param('id') id: string) {
    return this.service.approve(id);
  }

  @Patch(':id/reject')
  @Roles('admin', 'owner')
  reject(@Param('id') id: string) {
    return this.service.reject(id);
  }

  @Patch(':id/cancel')
  @Roles('admin', 'owner')
  cancel(@Param('id') id: string) {
    return this.service.cancel(id);
  }

  @Patch(':id/no-show')
  @Roles('admin', 'owner')
  noShow(@Param('id') id: string) {
    return this.service.noShow(id);
  }

  @Patch(':id/check-in')
  @Roles('waiter', 'admin', 'owner')
  checkIn(@Param('id') id: string, @Req() request: any) {
    return this.service.checkIn(id, request.user);
  }

  @Patch(':id/complete')
  @Roles('waiter', 'admin', 'owner')
  complete(@Param('id') id: string, @Req() request: any) {
    return this.service.complete(id, request.user);
  }

  @Patch(':id/waiter-transfer')
  @Roles('admin', 'owner')
  waiterTransfer(@Param('id') id: string, @Body('tableId') tableId: string, @Req() request: any) {
    return this.tableLock.withTransferLock(id, tableId, () =>
      this.service.waiterTransfer(id, tableId, request.user),
    );
  }
}
