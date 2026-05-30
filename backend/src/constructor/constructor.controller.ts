import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ConstructorService } from './constructor.service';
import { UpdatePositionDto } from './dto/update-position.dto';
import { UpdateSizeDto } from './dto/update-size.dto';
import { ExpandMapDto } from './dto/expand-map.dto';
import { CreateMapObjectDto } from './dto/create-map-object.dto';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';

@Roles('owner', 'admin')
@Controller('constructor')
export class ConstructorController {
  constructor(private readonly service: ConstructorService) {}

  @Get('map')
  getFullMap() {
    return this.service.getFullMap();
  }

  @Public()
  @Get('public-map')
  getPublicMap() {
    return this.service.getPublicMap();
  }

  @Patch('tables/:id/position')
  updateTablePosition(@Param('id') id: string, @Body() dto: UpdatePositionDto) {
    return this.service.updateTablePosition(id, dto);
  }

  @Patch('tables/:id/size')
  updateTableSize(@Param('id') id: string, @Body() dto: UpdateSizeDto) {
    return this.service.updateTableSize(id, dto);
  }

  @Patch('tables/:id/hide')
  hideTable(@Param('id') id: string) {
    return this.service.setTableVisibility(id, false);
  }

  @Patch('tables/:id/show')
  showTable(@Param('id') id: string) {
    return this.service.setTableVisibility(id, true);
  }

  @Patch('zones/:id/position')
  updateZonePosition(@Param('id') id: string, @Body() dto: UpdatePositionDto) {
    return this.service.updateZonePosition(id, dto);
  }

  @Patch('zones/:id/size')
  updateZoneSize(@Param('id') id: string, @Body() dto: UpdateSizeDto) {
    return this.service.updateZoneSize(id, dto);
  }

  @Patch('zones/:id/hide')
  hideZone(@Param('id') id: string) {
    return this.service.setZoneVisibility(id, false);
  }

  @Patch('zones/:id/show')
  showZone(@Param('id') id: string) {
    return this.service.setZoneVisibility(id, true);
  }

  @Post('objects')
  createObject(@Body() dto: CreateMapObjectDto) {
    return this.service.createObject(dto);
  }

  @Patch('objects/:id/position')
  updateObjectPosition(@Param('id') id: string, @Body() dto: UpdatePositionDto) {
    return this.service.updateObjectPosition(id, dto);
  }

  @Patch('objects/:id/size')
  updateObjectSize(@Param('id') id: string, @Body() dto: UpdateSizeDto) {
    return this.service.updateObjectSize(id, dto);
  }

  @Patch('objects/:id/hide')
  hideObject(@Param('id') id: string) {
    return this.service.setObjectVisibility(id, false);
  }

  @Patch('objects/:id/show')
  showObject(@Param('id') id: string) {
    return this.service.setObjectVisibility(id, true);
  }

  @Delete('objects/:id')
  removeObject(@Param('id') id: string) {
    return this.service.removeObject(id);
  }

  @Post('map/expand')
  expandMap(@Body() dto: ExpandMapDto) {
    return this.service.expandMap(dto);
  }
}
