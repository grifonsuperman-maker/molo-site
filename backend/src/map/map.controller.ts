import { Controller, Get } from '@nestjs/common';

import { Public } from '../common/decorators/public.decorator';
import { MapService } from './map.service';

@Public()
@Controller('map')
export class MapController {
  constructor(private readonly service: MapService) {}

  @Get()
  getFullMap() {
    return this.service.getFullMap();
  }

  @Get('public')
  getPublicMap() {
    return this.service.getPublicMap();
  }
}
