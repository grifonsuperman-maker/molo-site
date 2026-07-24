import { Controller, Get, Query } from '@nestjs/common';

import { Roles } from '../common/decorators/roles.decorator';
import { AdminBookingEventsService } from './admin-booking-events.service';

@Roles('owner', 'admin')
@Controller('bookings/admin-events')
export class AdminBookingEventsController {
  constructor(private readonly events: AdminBookingEventsService) {}

  @Get()
  findRecent(@Query('limit') limit?: string) {
    return this.events.findRecent(Number(limit));
  }
}
