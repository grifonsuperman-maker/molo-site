import { Body, Controller, Get, Header, Patch, Post, Req } from '@nestjs/common';

import type { AuthUser } from '../auth/types/auth-user.type';
import { Roles } from '../common/decorators/roles.decorator';
import {
  ConnectSyrveDto,
  PreviewSyrveTablesDto,
  TestSyrveConnectionDto,
  UpdateSyrveConnectionDto,
} from './dto/syrve-integration.dto';
import { SyrveIntegrationService } from './syrve-integration.service';

@Roles('owner')
@Controller('syrve-integration')
export class SyrveIntegrationController {
  constructor(private readonly service: SyrveIntegrationService) {}

  @Get()
  getStatus() {
    return this.service.getStatus();
  }

  @Post('test')
  test(@Body() dto: TestSyrveConnectionDto) {
    return this.service.test(dto);
  }

  @Post('connect')
  connect(
    @Body() dto: ConnectSyrveDto,
    @Req() request: { user?: AuthUser },
  ) {
    return this.service.connect(dto, request.user);
  }

  @Post('tables-preview')
  @Header('Cache-Control', 'no-store')
  previewTables(@Body() dto: PreviewSyrveTablesDto) {
    return this.service.previewTables(dto);
  }

  @Post('recheck')
  recheck(@Req() request: { user?: AuthUser }) {
    return this.service.recheck(request.user);
  }

  @Patch()
  updateMetadata(@Body() dto: UpdateSyrveConnectionDto) {
    return this.service.updateMetadata(dto);
  }

  @Post('disconnect')
  disconnect(
    @Body() body: { reason?: string },
    @Req() request: { user?: AuthUser },
  ) {
    return this.service.disconnect(body?.reason, request.user);
  }
}
