import {
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Query,
} from '@nestjs/common';

import { Roles } from '../common/decorators/roles.decorator';
import { LogsService } from './logs.service';

function positiveInteger(
  value: string | undefined,
  fallback: number,
  maximum?: number,
) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return maximum ? Math.min(parsed, maximum) : parsed;
}

@Roles('owner', 'admin')
@Controller('logs')
export class LogsController {
  constructor(private readonly logsService: LogsService) {}

  @Get()
  findAll() {
    return this.logsService.findAll();
  }

  @Get('active')
  @Roles('owner')
  findActive(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.logsService.findActive(
      positiveInteger(page, 1),
      positiveInteger(limit, 50, 300),
    );
  }

  @Get('archive')
  @Roles('owner')
  findArchive(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.logsService.findArchive(
      positiveInteger(page, 1),
      positiveInteger(limit, 50, 100),
    );
  }

  @Patch(':id/archive')
  @Roles('owner')
  archive(@Param('id') id: string) {
    return this.logsService.archive(id);
  }

  @Delete(':id')
  @Roles('owner')
  deletePermanently(@Param('id') id: string) {
    return this.logsService.deletePermanently(id);
  }
}
