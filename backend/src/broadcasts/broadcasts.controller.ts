import { Body, Controller, Get, Param, Post } from '@nestjs/common';

import { Roles } from '../common/decorators/roles.decorator';
import { BroadcastsService } from './broadcasts.service';
import { CreateBroadcastDto } from './dto/create-broadcast.dto';

@Roles('owner', 'admin')
@Controller('broadcasts')
export class BroadcastsController {
  constructor(private readonly service: BroadcastsService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Post()
  create(@Body() dto: CreateBroadcastDto) {
    return this.service.create(dto);
  }

  @Post('send-now')
  sendNow(@Body() dto: CreateBroadcastDto) {
    return this.service.sendNow(dto);
  }

  @Post(':id/send')
  send(@Param('id') id: string) {
    return this.service.send(id);
  }
}
