import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';

import { Roles } from '../common/decorators/roles.decorator';
import { RestaurantService } from '../restaurant/restaurant.service';
import { BroadcastsService } from './broadcasts.service';
import { CreateBroadcastDto } from './dto/create-broadcast.dto';

@Roles('owner', 'admin')
@Controller('broadcasts')
export class BroadcastsController {
  constructor(
    private readonly service: BroadcastsService,
    private readonly restaurant: RestaurantService,
  ) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Post()
  async create(@Body() dto: CreateBroadcastDto, @Req() request: any) {
    await this.assertCanSend(request);
    return this.service.create(dto);
  }

  @Post('send-now')
  async sendNow(@Body() dto: CreateBroadcastDto, @Req() request: any) {
    await this.assertCanSend(request);
    return this.service.sendNow(dto);
  }

  @Post(':id/send')
  async send(@Param('id') id: string, @Req() request: any) {
    await this.assertCanSend(request);
    return this.service.send(id);
  }

  private async assertCanSend(request: any) {
    if (request.user?.role !== 'admin') return;
    await this.restaurant.assertAdminPermission(
      'adminCanSendBroadcasts',
      'Директор не надав право створювати ручні розсилки',
    );
  }
}
