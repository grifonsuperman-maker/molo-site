import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';

import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CreateZoneDto } from './dto/create-zone.dto';
import { UpdateZoneDto } from './dto/update-zone.dto';
import { ZonesService } from './zones.service';

@Controller('zones')
export class ZonesController {
  constructor(private readonly service: ZonesService) {}

  @Public()
  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Roles('owner')
  @Post()
  create(@Body() dto: CreateZoneDto) {
    return this.service.create(dto);
  }

  @Roles('owner')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateZoneDto) {
    return this.service.update(id, dto);
  }

  @Roles('owner')
  @Patch(':id/close')
  close(@Param('id') id: string) {
    return this.service.close(id);
  }

  @Roles('owner')
  @Patch(':id/open')
  open(@Param('id') id: string) {
    return this.service.open(id);
  }

  @Roles('admin')
  @Patch(':id/admin/close')
  adminClose(@Param('id') id: string) {
    return this.service.adminClose(id);
  }

  @Roles('admin')
  @Patch(':id/admin/open')
  adminOpen(@Param('id') id: string) {
    return this.service.adminOpen(id);
  }

  @Roles('owner')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
