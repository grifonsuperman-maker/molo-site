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

// Тимчасова read-only сумісність для вже відкритих старих версій frontend.
// Жодних методів редагування конструктора тут немає.
@Public()
@Controller('constructor')
export class LegacyMapCompatibilityController {
  constructor(private readonly service: MapService) {}

  @Get('map')
  getFullMap() {
    return this.service.getFullMap();
  }

  @Get('public-map')
  getPublicMap() {
    return this.service.getPublicMap();
  }
}
