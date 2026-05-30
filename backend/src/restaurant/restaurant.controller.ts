import { Body, Controller, Get, Patch, Post } from '@nestjs/common';

import { RestaurantService } from './restaurant.service';
import { UpdateRestaurantDto } from './dto/update-restaurant.dto';
import { CloseRestaurantDto } from './dto/close-restaurant.dto';

@Controller('restaurant')
export class RestaurantController {
  constructor(private readonly restaurantService: RestaurantService) {}

  @Get()
  getSettings() {
    return this.restaurantService.getSettings();
  }

  @Patch()
  update(@Body() dto: UpdateRestaurantDto) {
    return this.restaurantService.update(dto);
  }

  @Post('open')
  openRestaurant() {
    return this.restaurantService.openRestaurant();
  }

  @Post('close-booking')
  closeBooking() {
    return this.restaurantService.closeBooking();
  }

  @Post('close')
  closeRestaurant(@Body() dto: CloseRestaurantDto) {
    return this.restaurantService.closeRestaurant(dto);
  }
}
