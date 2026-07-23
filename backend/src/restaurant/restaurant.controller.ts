import { Body, Controller, Get, Patch, Post } from '@nestjs/common';

import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CloseRestaurantDto } from './dto/close-restaurant.dto';
import { UpdateRestaurantDto } from './dto/update-restaurant.dto';
import { UpdateThemeDto } from './dto/update-theme.dto';
import { RestaurantService } from './restaurant.service';

@Controller('restaurant')
export class RestaurantController {
  constructor(private readonly service: RestaurantService) {}

  @Public()
  @Get()
  getSettings() {
    return this.service.getSettings();
  }

  @Public()
  @Get('theme')
  getTheme() {
    return this.service.getTheme();
  }

  @Roles('owner')
  @Patch('theme')
  updateTheme(@Body() dto: UpdateThemeDto) {
    return this.service.updateTheme(dto);
  }

  @Roles('admin')
  @Patch('admin/theme')
  adminUpdateTheme(@Body() dto: UpdateThemeDto) {
    return this.service.adminUpdateTheme(dto);
  }

  @Roles('owner')
  @Patch()
  update(@Body() dto: UpdateRestaurantDto) {
    return this.service.update(dto);
  }

  @Roles('owner')
  @Post('open')
  open() {
    return this.service.openRestaurant();
  }

  @Roles('owner')
  @Post('open-booking')
  openBooking() {
    return this.service.openBooking();
  }

  @Roles('owner')
  @Post('close-booking')
  closeBooking() {
    return this.service.closeBooking();
  }

  @Roles('owner')
  @Post('close')
  close(@Body() dto: CloseRestaurantDto) {
    return this.service.closeRestaurant(dto);
  }

  @Roles('admin')
  @Post('admin/open-booking')
  adminOpenBooking() {
    return this.service.adminOpenBooking();
  }

  @Roles('admin')
  @Post('admin/close-booking')
  adminCloseBooking() {
    return this.service.adminCloseBooking();
  }

  @Roles('admin')
  @Post('admin/open')
  adminOpenRestaurant() {
    return this.service.adminOpenRestaurant();
  }

  @Roles('admin')
  @Post('admin/close')
  adminCloseRestaurant(@Body() dto: CloseRestaurantDto) {
    return this.service.adminCloseRestaurant(dto);
  }

  @Roles('admin')
  @Patch('admin/site-mode')
  adminChangeSiteMode(@Body() dto: UpdateRestaurantDto) {
    return this.service.adminChangeSiteMode(
      dto.siteMode || 'night',
      dto.holidayKey,
    );
  }

  @Roles('admin')
  @Patch('admin/settings')
  adminUpdateSettings(@Body() dto: UpdateRestaurantDto) {
    return this.service.adminUpdateSettings(dto);
  }
}
