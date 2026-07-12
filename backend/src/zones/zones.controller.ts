import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ZonesService } from './zones.service';
import { CreateZoneDto } from './dto/create-zone.dto';
import { UpdateZoneDto } from './dto/update-zone.dto';
import { Public } from '../common/decorators/public.decorator';

@Controller('zones')
export class ZonesController {
  constructor(private readonly service: ZonesService) {}

  @Public()
  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Public()
  @Post()
  create(@Body() dto: CreateZoneDto) {
    return this.service.create(dto);
  }

  @Public()
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateZoneDto) {
    return this.service.update(id, dto);
  }

  @Public()
  @Patch(':id/close')
  close(@Param('id') id: string) {
    return this.service.close(id);
  }

  @Public()
  @Patch(':id/open')
  open(@Param('id') id: string) {
    return this.service.open(id);
  }

  @Public()
  @Patch(':id/admin/close')
  adminClose(@Param('id') id: string) {
    return this.service.adminClose(id);
  }

  @Public()
  @Patch(':id/admin/open')
  adminOpen(@Param('id') id: string) {
    return this.service.adminOpen(id);
  }

  @Public()
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
