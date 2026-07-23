import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';

import { Roles } from '../common/decorators/roles.decorator';
import { AdminBookingsService } from './admin-bookings.service';
import { AdminChangeTableDto } from './dto/admin-change-table.dto';
import { CreateAdminBookingDto } from './dto/create-admin-booking.dto';

@Roles('owner', 'admin')
@Controller('admin/bookings')
export class AdminBookingsController {
  constructor(private readonly service: AdminBookingsService) {}

  @Post('manual')
  createManual(@Body() dto: CreateAdminBookingDto) {
    return this.service.createManual(dto);
  }

  @Patch(':id/change-table')
  changeTable(@Param('id') id: string, @Body() dto: AdminChangeTableDto) {
    return this.service.changeTable(id, dto);
  }

  @Get('upcoming')
  upcoming(@Query('days') days?: string) {
    return this.service.upcoming(Number(days));
  }
}
