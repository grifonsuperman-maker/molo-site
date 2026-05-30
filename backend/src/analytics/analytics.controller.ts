import { Controller, Get, Query } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { Roles } from '../common/decorators/roles.decorator';

@Roles('owner', 'admin')
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly service: AnalyticsService) {}

  @Get('today')
  today() {
    return this.service.getToday();
  }

  @Get('summary')
  summary(@Query('from') from?: string, @Query('to') to?: string) {
    return this.service.getSummary(from, to);
  }

  @Get('popular-tables')
  popularTables(@Query('from') from?: string, @Query('to') to?: string) {
    return this.service.getPopularTables(from, to);
  }

  @Get('popular-zones')
  popularZones(@Query('from') from?: string, @Query('to') to?: string) {
    return this.service.getPopularZones(from, to);
  }

  @Get('regular-clients')
  regularClients() {
    return this.service.getRegularClients();
  }

  @Get('hourly-load')
  hourlyLoad(@Query('date') date?: string) {
    return this.service.getHourlyLoad(date);
  }
}
