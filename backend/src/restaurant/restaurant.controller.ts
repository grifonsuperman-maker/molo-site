import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { RestaurantService } from './restaurant.service';
import { UpdateRestaurantDto } from './dto/update-restaurant.dto';
import { CloseRestaurantDto } from './dto/close-restaurant.dto';
import { Public } from '../common/decorators/public.decorator';

@Controller('restaurant')
export class RestaurantController {
  constructor(private readonly service: RestaurantService) {}

  @Public()
  @Get()
  getSettings() {
    return this.service.getSettings();
  }

  @Public()
  @Patch()
  update(@Body() dto: UpdateRestaurantDto) {
    return this.service.update(dto);
  }

  @Public()
  @Post('open')
  open() {
    return this.service.openRestaurant();
  }

  @Public()
  @Post('open-booking')
  openBooking() {
    return this.service.openBooking();
  }

  @Public()
  @Post('close-booking')
  closeBooking() {
    return this.service.closeBooking();
  }

  @Public()
  @Post('close')
  close(@Body() dto: CloseRestaurantDto) {
    return this.service.closeRestaurant(dto);
  }

  @Public()
  @Post('admin/open-booking')
  adminOpenBooking() {
    return this.service.adminOpenBooking();
  }

  @Public()
  @Post('admin/close-booking')
  adminCloseBooking() {
    return this.service.adminCloseBooking();
  }

  @Public()
  @Post('admin/open')
  adminOpenRestaurant() {
    return this.service.adminOpenRestaurant();
  }

  @Public()
  @Post('admin/close')
  adminCloseRestaurant(@Body() dto: CloseRestaurantDto) {
    return this.service.adminCloseRestaurant(dto);
  }

  @Public()
  @Patch('admin/site-mode')
  adminChangeSiteMode(@Body() dto: UpdateRestaurantDto) {
    return this.service.adminChangeSiteMode(dto.siteMode || 'night');
  }

  @Public()
  @Patch('admin/settings')
  adminUpdateSettings(@Body() dto: UpdateRestaurantDto) {
    return this.service.adminUpdateSettings(dto);
  }
}
