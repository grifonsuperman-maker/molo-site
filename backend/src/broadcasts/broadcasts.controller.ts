import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { BroadcastsService } from './broadcasts.service';
import { CreateBroadcastDto } from './dto/create-broadcast.dto';
import { Roles } from '../common/decorators/roles.decorator';

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

  @Post(':id/send')
  send(@Param('id') id: string) {
    return this.service.send(id);
  }
}
