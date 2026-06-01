import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ConstructorService } from './constructor.service';
import { UpdatePositionDto } from './dto/update-position.dto';
import { UpdateSizeDto } from './dto/update-size.dto';
import { ExpandMapDto } from './dto/expand-map.dto';
import { CreateMapObjectDto } from './dto/create-map-object.dto';
import { Public } from '../common/decorators/public.decorator';

@Controller('constructor')
export class ConstructorController {
  constructor(private readonly service: ConstructorService) {}

  @Public()
  @Get('map')
  getFullMap() {
    return this.service.getFullMap();
  }

  @Public()
  @Get('public-map')
  getPublicMap() {
    return this.service.getPublicMap();
  }

  @Public()
  @Patch('tables/:id/position')
  updateTablePosition(@Param('id') id: string, @Body() dto: UpdatePositionDto) {
    return this.service.updateTablePosition(id, dto);
  }

  @Public()
  @Patch('tables/:id/size')
  updateTableSize(@Param('id') id: string, @Body() dto: UpdateSizeDto) {
    return this.service.updateTableSize(id, dto);
  }

  @Public()
  @Patch('tables/:id/hide')
  hideTable(@Param('id') id: string) {
    return this.service.setTableVisibility(id, false);
  }

  @Public()
  @Patch('tables/:id/show')
  showTable(@Param('id') id: string) {
    return this.service.setTableVisibility(id, true);
  }

  @Public()
  @Patch('zones/:id/position')
  updateZonePosition(@Param('id') id: string, @Body() dto: UpdatePositionDto) {
    return this.service.updateZonePosition(id, dto);
  }

  @Public()
  @Patch('zones/:id/size')
  updateZoneSize(@Param('id') id: string, @Body() dto: UpdateSizeDto) {
    return this.service.updateZoneSize(id, dto);
  }

  @Public()
  @Patch('zones/:id/hide')
  hideZone(@Param('id') id: string) {
    return this.service.setZoneVisibility(id, false);
  }

  @Public()
  @Patch('zones/:id/show')
  showZone(@Param('id') id: string) {
    return this.service.setZoneVisibility(id, true);
  }

  @Public()
  @Post('objects')
  createObject(@Body() dto: CreateMapObjectDto) {
    return this.service.createObject(dto);
  }

  @Public()
  @Patch('objects/:id/position')
  updateObjectPosition(@Param('id') id: string, @Body() dto: UpdatePositionDto) {
    return this.service.updateObjectPosition(id, dto);
  }

  @Public()
  @Patch('objects/:id/size')
  updateObjectSize(@Param('id') id: string, @Body() dto: UpdateSizeDto) {
    return this.service.updateObjectSize(id, dto);
  }

  @Public()
  @Patch('objects/:id/hide')
  hideObject(@Param('id') id: string) {
    return this.service.setObjectVisibility(id, false);
  }

  @Public()
  @Patch('objects/:id/show')
  showObject(@Param('id') id: string) {
    return this.service.setObjectVisibility(id, true);
  }

  @Public()
  @Delete('objects/:id')
  removeObject(@Param('id') id: string) {
    return this.service.removeObject(id);
  }

  @Public()
  @Post('map/expand')
  expandMap(@Body() dto: ExpandMapDto) {
    return this.service.expandMap(dto);
  }
}
