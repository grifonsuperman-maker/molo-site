import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { RestaurantService } from './restaurant.service';
import { UpdateRestaurantDto } from './dto/update-restaurant.dto';
import { CloseRestaurantDto } from './dto/close-restaurant.dto';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';

@Roles('owner', 'admin')
@Controller('restaurant')
export class RestaurantController {
  constructor(private readonly service: RestaurantService) {}

  @Public()
  @Get()
  getSettings() {
    return this.service.getSettings();
  }

  @Patch()
  update(@Body() dto: UpdateRestaurantDto) {
    return this.service.update(dto);
  }

  @Post('open')
  open() {
    return this.service.openRestaurant();
  }

  @Post('close-booking')
  closeBooking() {
    return this.service.closeBooking();
  }

  @Post('close')
  close(@Body() dto: CloseRestaurantDto) {
    return this.service.closeRestaurant(dto);
  }
}
