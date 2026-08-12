import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ZonesService } from './zones.service';
import { CreateZoneDto } from './dto/create-zone.dto';
import { UpdateZoneDto } from './dto/update-zone.dto';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('zones')
export class ZonesController {
  constructor(private readonly service: ZonesService) {}

  @Public()
  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Post()
  @Roles('owner')
  create(@Body() dto: CreateZoneDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @Roles('owner')
  update(@Param('id') id: string, @Body() dto: UpdateZoneDto) {
    return this.service.update(id, dto);
  }

  @Patch(':id/close')
  @Roles('owner')
  close(@Param('id') id: string) {
    return this.service.close(id);
  }

  @Patch(':id/open')
  @Roles('owner')
  open(@Param('id') id: string) {
    return this.service.open(id);
  }

  @Patch(':id/admin/close')
  @Roles('admin', 'owner')
  adminClose(@Param('id') id: string) {
    return this.service.adminClose(id);
  }

  @Patch(':id/admin/open')
  @Roles('admin', 'owner')
  adminOpen(@Param('id') id: string) {
    return this.service.adminOpen(id);
  }

  @Delete(':id')
  @Roles('owner')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
