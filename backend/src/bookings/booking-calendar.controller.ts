import { Controller, Get, Query } from '@nestjs/common';

import { Public } from '../common/decorators/public.decorator';
import { BookingCalendarService } from './booking-calendar.service';

@Controller('bookings-calendar')
export class BookingCalendarController {
  constructor(private readonly calendar: BookingCalendarService) {}

  @Public()
  @Get('upcoming')
  upcoming(@Query('days') days?: string) {
    return this.calendar.upcoming(days);
  }
}
